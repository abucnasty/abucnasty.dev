// The wiki editor, in place of a page: a toolbar, the visual editor (Milkdown) or the markdown
// editor (CodeMirror), and the save bar (Draft/Published, "What did you change?", Save). Loaded
// only when an editor presses Edit or creates a page; readers never download it.
//
// - The page's file comes from the vault's main branch (GET /api/wiki/source), split into its
//   frontmatter (never shown; sent back as loaded) and body.
// - Visual mode opens the first time; afterwards each device remembers the last mode. Switching
//   modes without changing anything keeps the text exactly as it was; only text changed in the
//   visual editor is rewritten in the house style (markdown.ts).
// - Images pasted, dropped or chosen are converted (images.ts), shown at once and uploaded with
//   the save into the page's _attachments folder, inserted as ![[name]].
// - Saving shows what happened: saved (and that the site updates in about a minute), or why not,
//   with the text kept on screen and a "Copy my text" button.
// - Edits made by someone else meanwhile (worker/wikiMerge.ts): combined by the Worker when they
//   don't overlap (the page view then says with whose edit, and shows the combined page); when
//   they do, the two versions side by side (Combine.tsx) to choose from and save combined. A page
//   renamed meanwhile is saved at its new address; one deleted meanwhile can be saved as a new
//   page (asking for another title when its title is taken) or discarded.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Popper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import FormatBold from '@mui/icons-material/FormatBold';
import FormatItalic from '@mui/icons-material/FormatItalic';
import StrikethroughS from '@mui/icons-material/StrikethroughS';
import LinkIcon from '@mui/icons-material/Link';
import FormatListBulleted from '@mui/icons-material/FormatListBulleted';
import FormatListNumbered from '@mui/icons-material/FormatListNumbered';
import Checklist from '@mui/icons-material/Checklist';
import FormatQuote from '@mui/icons-material/FormatQuote';
import Info from '@mui/icons-material/InfoOutlined';
import Code from '@mui/icons-material/Code';
import TableChart from '@mui/icons-material/TableChartOutlined';
import ImageIcon from '@mui/icons-material/ImageOutlined';
import YouTube from '@mui/icons-material/YouTube';
import ArrowDropDown from '@mui/icons-material/ArrowDropDown';
import { markdownSx } from '../components/MarkdownRenderer';
import { wikiSx } from '../components/WikiMarkdown';
import { layout } from '../layout';
import { findWikiTarget, resolveWikiFile, wikiFileUrl, wikiSlug, youtubeVideo, type WikiIndex } from '../wikiCore';
import { rememberMoved, rememberSaved } from '../wikiSaved';
import { isEditor, useWikiSession } from '../wikiAuth';
import { MAX_SUMMARY } from '../wikiSource';
import { loadSource, savePage, SaveError, type Conflict, type Gone, type PageSource, type SaveResult } from './api';
import { savedNotice, timeAgo } from './concurrent';
import { ImageError, prepareImage, type PreparedImage } from './images';
import type { MarkdownAction } from './MarkdownEditor';
import { createVisualEditor, type BlockStyle, type VisualEditor, type WikiLookup } from './milkdown';

// CodeMirror comes in its own chunk, the first time Markdown mode opens.
const MarkdownEditor = lazy(() => import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })));
// The side-by-side view of two edits made at the same time, the first time one is shown.
const Combine = lazy(() => import('./Combine'));

type Mode = 'visual' | 'markdown';
const MODE_KEY = 'wiki-editor-mode';

function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'markdown' ? 'markdown' : 'visual';
  } catch {
    return 'visual';
  }
}

function storeMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode: not remembered */
  }
}

export interface WikiEditorProps {
  index: WikiIndex;
  /** The page's slug (an existing page), or a new page's title and folder. */
  target: { slug: string } | { create: { title: string; folder: string } };
  onClose: () => void;
  onSaved: (result: SaveResult) => void;
}

const LEAVE = 'Leave without saving? Your changes on this page will be lost.';

/** Warn before the page is left with unsaved changes: closing the tab, reloading, or a link in the site. */
function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.closest('[data-wiki-editor-content]')) return;
      const to = new URL(a.href, location.href);
      if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) return;
      if (!window.confirm(LEAVE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [active]);
}

/** The visual editor's look: the page's own markdown style, plus the editor-only marks. */
const visualSx = (theme: Theme) => ({
  '& .ProseMirror': { outline: 'none', minHeight: '50vh', pb: 4, whiteSpace: 'pre-wrap', wordWrap: 'break-word' },
  '& .ProseMirror p:first-of-type': { mt: 0 },
  '& .wiki-link-node': { color: theme.palette.primary.main, textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'default' },
  '& .wiki-link-node.wiki-missing': { color: theme.palette.text.secondary, textDecoration: 'underline dotted' },
  '& .wiki-embed-node, & .wiki-comment-node': { fontFamily: 'monospace', fontSize: '0.9em', px: 0.5, borderRadius: 0.5, backgroundColor: theme.palette.background.paper },
  '& .wiki-comment-node, & .wiki-comment-block': { color: theme.palette.text.disabled },
  '& .wiki-comment-block': { fontFamily: 'monospace', fontSize: '0.85em', whiteSpace: 'pre-wrap', border: '1px dashed', borderColor: theme.palette.divider, p: 1, my: 2 },
  '& img.wiki-embed-image': { display: 'inline-block', maxWidth: '100%', my: 1 },
  '& .ProseMirror-selectednode': { outline: `2px solid ${theme.palette.primary.main}` },
  '& blockquote:has(.callout-marker)': { borderColor: theme.palette.info.main, backgroundColor: 'rgba(41, 182, 246, 0.08)', color: 'text.primary', py: 0.5 },
  '& .callout-marker': { fontWeight: 700, fontSize: '0.75em', letterSpacing: 1, color: theme.palette.info.main, mr: 0.5 },
  '& li[data-item-type="task"]': { listStyle: 'none', position: 'relative', '&::before': { content: '"☐"', position: 'absolute', left: '-1.4em', cursor: 'pointer' } },
  '& li[data-item-type="task"][data-checked="true"]::before': { content: '"☑"' },
  '& table': { borderCollapse: 'collapse', my: 2, display: 'block', overflowX: 'auto' },
  // Code blocks (codeBlockView.ts): the language field above, a ```mermaid block's diagram below,
  // drawn as on the page (MermaidDiagram.tsx): wide ones scroll inside their box.
  '& .wiki-code-block': { my: 2, '& pre': { my: 0 } },
  '& .wiki-code-bar': { display: 'flex', justifyContent: 'flex-end', userSelect: 'none' },
  '& .wiki-code-language': {
    width: '9em',
    font: 'inherit',
    fontFamily: 'monospace',
    fontSize: '0.8em',
    color: theme.palette.text.secondary,
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '1px dashed',
    borderColor: theme.palette.divider,
    textAlign: 'right',
    px: 0.5,
    mb: 0.25,
    outline: 'none',
    '&:focus': { borderColor: theme.palette.primary.main, color: theme.palette.text.primary },
  },
  '& .wiki-mermaid-preview': { whiteSpace: 'normal', userSelect: 'none', mt: 1, cursor: 'default' },
  '& .wiki-mermaid-head': { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, fontSize: '0.75rem', color: theme.palette.text.secondary, mb: 0.5 },
  '& .wiki-mermaid-toggle': { font: 'inherit', color: theme.palette.primary.main, background: 'none', border: 'none', cursor: 'pointer', p: 0, '&:hover': { textDecoration: 'underline' } },
  '& .wiki-mermaid-diagram': { overflowX: 'auto', backgroundColor: theme.palette.background.paper, p: 2, '& svg': { display: 'block', mx: 'auto' } },
  '& .wiki-mermaid-note': { fontSize: '0.8rem', color: theme.palette.text.secondary, mb: 0.5 },
  '& .wiki-mermaid-preview[data-mermaid-preview="error"] .wiki-mermaid-note': { color: theme.palette.warning.main },
  '& td, & th': { border: '1px solid', borderColor: theme.palette.divider, px: 1, py: 0.5, minWidth: 60, '& p': { my: 0 } },
});

/** The link shown for `[[value]]`, as the reader would show it. */
function linkLabel(index: WikiIndex, value: string): { label: string; missing: boolean } {
  const bar = value.indexOf('|');
  const target = (bar === -1 ? value : value.slice(0, bar)).trim();
  const label = bar === -1 ? '' : value.slice(bar + 1).trim();
  const hash = target.indexOf('#');
  const page = (hash === -1 ? target : target.slice(0, hash)).trim();
  const heading = hash === -1 ? '' : target.slice(hash + 1).replace(/^#+/, '').trim();
  const missing = page !== '' && !findWikiTarget(index, page);
  return { label: label || (page && heading ? `${page} › ${heading}` : page || heading), missing };
}

type Load = { status: 'loading' } | { status: 'ready'; source: PageSource } | { status: 'failed'; message: string };
type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'failed'; code: string; message: string };
/** Two edits to combine, and how saving the combined version went. */
type Combining = { conflict: Conflict; busy: boolean; error: string | null };
/** The page was deleted meanwhile: save the text as a new page (under `title`) or discard it. */
type Deleted = { gone: Gone; title: string; askTitle: boolean; busy: boolean; error: string | null };

export function WikiEditor({ index, target, onClose, onSaved }: WikiEditorProps) {
  const [load, setLoad] = useState<Load>(() =>
    'create' in target
      ? { status: 'ready', source: { path: null, title: target.create.title, folder: target.create.folder, blob: null, frontmatter: '', body: '', draft: false } }
      : { status: 'loading' },
  );
  const slug = 'slug' in target ? target.slug : null;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    setLoad({ status: 'loading' });
    loadSource(slug).then(
      (source) => live && setLoad({ status: 'ready', source }),
      (err) => live && setLoad({ status: 'failed', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  if (load.status === 'loading') {
    return (
      <Box role="status" aria-label="Opening the editor" sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-hidden />
      </Box>
    );
  }
  if (load.status === 'failed') {
    return (
      <Alert
        severity="error"
        data-wiki-editor-failed
        action={
          <Stack direction="row" spacing={1}>
            <Button color="inherit" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
            <Button color="inherit" size="small" onClick={onClose}>
              Close
            </Button>
          </Stack>
        }
      >
        {load.message}
      </Alert>
    );
  }
  return <EditorBody key={load.source.blob ?? 'new'} index={index} source={load.source} onClose={onClose} onSaved={onSaved} />;
}

function EditorBody({ index, source, onClose, onSaved }: { index: WikiIndex; source: PageSource; onClose: () => void; onSaved: (r: SaveResult) => void }) {
  const session = useWikiSession();
  const [mode, setModeState] = useState<Mode>(storedMode);
  const [text, setText] = useState(source.body);
  const [draft, setDraft] = useState(source.draft);
  const [summary, setSummary] = useState('');
  const [touched, setTouched] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [picker, setPicker] = useState<PickerAt | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  /**
   * What the dialog's answer does, run as it starts to close (its focus trap is off by then, and
   * its fields are still on the page). The dialog does not hand focus back itself: that puts the
   * browser's cursor at the top of the page, which the visual editor then takes as its selection.
   * Focusing the editor after the dialog's fields are gone has Chromium stop reporting selection
   * changes, so clicks in the text no longer move the editor's cursor. The editor puts its own
   * cursor back when it is focused.
   */
  const afterAsk = useRef<(() => void) | null>(null);
  /** The style of the block at the cursor, for the style picker. */
  const [blockStyle, setBlockStyle] = useState<BlockStyle>(0);
  const [calloutMenu, setCalloutMenu] = useState<HTMLElement | null>(null);
  const [combining, setCombining] = useState<Combining | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const top = useRef<HTMLDivElement>(null);
  // The two versions (or the deleted page's choices) open above the editor: bring them into view.
  const shownConflict = combining?.conflict;
  const shownGone = deleted?.gone;
  useEffect(() => {
    if (shownConflict || shownGone) top.current?.scrollIntoView({ block: 'start' });
  }, [shownConflict, shownGone]);

  const visual = useRef<VisualEditor | null>(null);
  const visualHost = useRef<HTMLDivElement>(null);
  /** The visual editor's document differs from `text` (it was edited since it opened). */
  const visualDirty = useRef(false);
  const code = useRef<{ run(a: MarkdownAction): void } | null>(null);
  const images = useRef(new Map<string, PreparedImage>());
  const fileInput = useRef<HTMLInputElement>(null);

  useLeaveWarning(touched && save.status !== 'saving');

  const titles = useCallback(() => index.pages.map((p) => p.title), [index]);
  const lookup = useMemo<WikiLookup>(
    () => ({
      link: (value) => linkLabel(index, value),
      image: (value) => {
        const name = value.split('|')[0].trim();
        const pending = images.current.get(name);
        if (pending) return pending.url;
        const file = resolveWikiFile(index, name, source.folder);
        return file ? wikiFileUrl(file) : null;
      },
    }),
    [index, source.folder],
  );

  /** The body as it stands now. */
  const currentText = useCallback((): string => {
    if (mode === 'visual' && visual.current && visualDirty.current) return visual.current.markdown();
    return text;
  }, [mode, text]);

  // The visual editor lives while visual mode is on; it opens on the current text.
  useEffect(() => {
    if (mode !== 'visual' || !visualHost.current) return;
    let live = true;
    let made: VisualEditor | null = null;
    const host = visualHost.current;
    visualDirty.current = false;
    createVisualEditor(host, text, lookup, {
      onChange: () => {
        visualDirty.current = true;
        setTouched(true);
      },
      onWikiLinkTrigger: (at) => setPicker(at),
      onImageFiles: (files) => void addImages(files),
      onBlockStyle: setBlockStyle,
    }).then(
      (editor) => {
        if (!live) {
          void editor.destroy();
          return;
        }
        made = editor;
        visual.current = editor;
      },
      (err) => {
        if (!live) return;
        console.error(err);
        setNotice("The visual editor can't show this page's markdown, so it opened in Markdown mode. Nothing was changed.");
        setModeState('markdown');
      },
    );
    return () => {
      live = false;
      if (made) void made.destroy();
      visual.current = null;
      host.innerHTML = '';
    };
    // Recreated only when the mode changes: the text is carried over by setMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const setMode = (next: Mode | null) => {
    if (!next || next === mode) return;
    if (mode === 'visual' && visual.current && visualDirty.current) setText(visual.current.markdown());
    storeMode(next);
    setNotice(null);
    setModeState(next);
  };

  const act = (a: MarkdownAction) => {
    if (mode === 'markdown') {
      code.current?.run(a);
      return;
    }
    const v = visual.current;
    if (!v) return;
    if (a.kind === 'wikiLink') {
      const c = v.view().coordsAtPos(v.view().state.selection.from);
      setPicker({ left: c.left, top: c.top, bottom: c.bottom });
    } else if (a.kind === 'embed') v.insertEmbed(a.value);
    else v.run(a);
  };

  async function addImages(files: File[]) {
    setImageError(null);
    for (const file of files) {
      try {
        const img = await prepareImage(file);
        images.current.set(img.name, img);
        setTouched(true);
        act({ kind: 'embed', value: img.name });
      } catch (err) {
        setImageError(err instanceof ImageError ? err.message : `${file.name} couldn't be added.`);
      }
    }
  }
  // `act` reads the current mode; the visual editor's callback keeps the first closure.
  const addImagesRef = useRef(addImages);
  addImagesRef.current = addImages;

  const pickPage = (value: string | null) => {
    const at = picker;
    setPicker(null);
    if (!at) return;
    if (mode === 'markdown') return;
    const v = visual.current;
    if (!v) return;
    // Replacing a selected wiki link: the new one takes its place; cancelled, it stays as it was.
    if (value && value.trim() !== '') v.insertWikiLink(value.trim());
    else if (at.replace !== undefined) v.focus();
    else {
      // Cancelled: put back what was typed.
      const view = v.view();
      view.dispatch(view.state.tr.insertText('[['));
      view.focus();
    }
  };

  /**
   * The Link button. In visual mode it edits the link at the cursor or selection (the dialog shows
   * its address and text, with "Remove link"), and on a selected wiki link opens the page picker
   * to replace it.
   */
  const openLink = () => {
    const v = mode === 'visual' ? visual.current : null;
    if (!v) {
      setAsk({ kind: 'link', url: '', text: '', textField: 'insert', editing: false });
      return;
    }
    const t = v.linkTarget();
    if (t.kind === 'wiki') {
      const c = v.view().coordsAtPos(t.pos);
      setPicker({ left: c.left, top: c.top, bottom: c.bottom, replace: t.value });
    } else if (t.kind === 'link') {
      setAsk({ kind: 'link', url: t.href, text: t.text ?? '', textField: t.text === null ? 'none' : 'edit', editing: true });
    } else {
      setAsk({ kind: 'link', url: '', text: '', textField: t.kind === 'selection' ? 'none' : 'insert', editing: false });
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(currentText());
      setCopied(true);
    } catch {
      setCopied(false);
      setSave({ status: 'failed', code: 'copy', message: "Couldn't copy to the clipboard. Switch to Markdown mode and copy the text from there." });
    }
  };

  /** Only images still on the page go up. */
  const imagesIn = (body: string) => [...images.current.values()].filter((i) => body.includes(`![[${i.name}`)).map((i) => ({ name: i.name, blob: i.blob }));

  /** Saved: remember the page as saved (the combined text, at its new address) and close. */
  const finish = (result: SaveResult, body: string) => {
    setTouched(false);
    const shown = result.body ?? body;
    const done = { ...result, notice: savedNotice(result, Date.now()) };
    if (!result.unchanged || result.merged || result.renamedFrom) {
      const files = (result.images ?? []).map((i) => ({
        path: i.path.replace(/^wiki\//, ''),
        published: '',
        type: '',
        size: 0,
        v: i.oid,
        url: `/api/wiki/image/${i.oid}`,
      }));
      const old = index.pages.find((p) => p.slug === result.slug) ?? index.pages.find((p) => p.slug === wikiSlug(source.title));
      const page = {
        meta: {
          ...(old ?? { aliases: [], headings: [], excerpt: '', links: [], files: [] }),
          title: result.title,
          slug: result.slug,
          folder: result.folder,
          blob: result.blob,
          draft: result.draft,
        },
        body: shown,
        files,
        draft: result.draft,
        created: !!result.created,
        at: Date.now(),
      };
      const from = wikiSlug(source.title);
      if (result.renamedFrom && from !== result.slug) {
        // At the new address first (with the notice): the old one would redirect there without it.
        onSaved(done);
        rememberMoved(from, page);
        return;
      }
      rememberSaved(page);
    }
    onSaved(done);
  };

  /** The draft switch to send against `next` (the page as it is now): the editor's, if they changed it. */
  const draftFor = (next: { draft: boolean }) => (draft !== source.draft ? draft : next.draft);

  /** A save refused: a conflict opens the two versions, a deleted page offers to save it anew. */
  const refused = (err: unknown): string | null => {
    const e = err instanceof SaveError ? err : new SaveError(0, 'error', 'Saving failed. Nothing was saved; try again.');
    const conflict = e.conflict();
    if (conflict) {
      setCombining({ conflict, busy: false, error: null });
      setSave({ status: 'idle' });
      return null;
    }
    const gone = e.gone();
    if (gone) {
      setCombining(null);
      setDeleted({ gone, title: gone.title, askTitle: false, busy: false, error: null });
      setSave({ status: 'idle' });
      return null;
    }
    return e.message;
  };

  const doSave = async () => {
    const body = currentText();
    if (source.path !== null && body === source.body && draft === source.draft && images.current.size === 0) {
      onClose();
      return;
    }
    if (body.trim() === '' && source.path === null) {
      setSave({ status: 'failed', code: 'empty', message: 'Write something on the page first.' });
      return;
    }
    setSave({ status: 'saving' });
    setCopied(false);
    try {
      finish(await savePage({ source, body, draft, summary, images: imagesIn(body) }), body);
    } catch (err) {
      const message = refused(err);
      if (message !== null) setSave({ status: 'failed', code: err instanceof SaveError ? err.code : 'error', message });
    }
  };

  /** "Save combined version": against the page as it is now (merged again if it changed once more). */
  const saveCombined = async (body: string) => {
    if (!combining) return;
    const c = combining.conflict;
    setCombining({ ...combining, busy: true, error: null });
    const now: PageSource = { path: c.path, title: c.title, folder: c.folder, blob: c.theirs.blob, head: c.theirs.head, frontmatter: c.theirs.frontmatter, body: c.theirs.body, draft: c.theirs.draft };
    try {
      const result = await savePage({ source: now, body, draft: draftFor(c.theirs), summary, images: imagesIn(body) });
      // Renamed before the conflict: the rename is news here too.
      finish(c.renamedFrom && !result.renamedFrom ? { ...result, renamedFrom: c.renamedFrom } : result, body);
    } catch (err) {
      const message = refused(err);
      if (message !== null) setCombining({ conflict: c, busy: false, error: message });
    }
  };

  /** "Save as a new page": the text as a new page at the deleted page's place (or under a new title). */
  const saveAsNew = async () => {
    if (!deleted) return;
    const body = currentText();
    const title = deleted.title.trim();
    setDeleted({ ...deleted, busy: true, error: null });
    const fresh: PageSource = { path: null, title, folder: deleted.gone.folder, blob: null, frontmatter: '', body: '', draft };
    try {
      finish(await savePage({ source: fresh, body, draft, summary, images: imagesIn(body) }), body);
    } catch (err) {
      const e = err instanceof SaveError ? err : new SaveError(0, 'error', 'Saving failed. Nothing was saved; try again.');
      // Its title is taken (or isn't one a page can have): ask for another.
      const ask = e.code === 'exists' || (e.code === 'bad_request' && deleted.askTitle);
      setDeleted({ ...deleted, title, busy: false, askTitle: deleted.askTitle || ask, error: e.message });
    }
  };

  const noAccess = session.status === 'signed-out' || (session.status === 'signed-in' && !isEditor(session));
  const tool = (label: string, icon: React.ReactNode, a: () => void, shortcut?: string) => (
    <Tooltip title={shortcut ? `${label} (${shortcut})` : label}>
      <IconButton size="small" aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={a}>
        {icon}
      </IconButton>
    </Tooltip>
  );
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  return (
    <Stack spacing={2} data-wiki-editor data-mode={mode} ref={top} sx={{ scrollMarginTop: layout.topBarHeight + 16 }}>
      {noAccess && (
        <Alert severity="warning" data-wiki-editor-no-access>
          {session.status === 'signed-out' ? "You're signed out" : "You don't have wiki access any more"}, so this can't be saved. Your text is still here: copy it before you leave.
        </Alert>
      )}
      {notice && (
        <Alert severity="info" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {deleted && (
        <Alert
          severity="warning"
          data-wiki-deleted-meanwhile
          action={
            <Stack direction="row" spacing={1}>
              {!deleted.askTitle && (
                <Button color="inherit" size="small" onClick={() => void saveAsNew()} disabled={deleted.busy || noAccess} data-wiki-save-as-new>
                  Save as a new page
                </Button>
              )}
              <Button color="inherit" size="small" onClick={onClose} disabled={deleted.busy} data-wiki-discard>
                Discard
              </Button>
            </Stack>
          }
        >
          {deleted.gone.deleted ? `${deleted.gone.deleted.author} deleted this page ${timeAgo(deleted.gone.deleted.date, Date.now())}` : 'This page was deleted'} while you were editing. Your text is still here: save it as a new page, or discard it.
          {deleted.error && (
            <Box sx={{ mt: 1 }} data-wiki-save-as-new-error>
              {deleted.error}
            </Box>
          )}
          {deleted.askTitle && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5, alignItems: { sm: 'center' } }}>
              <TextField
                size="small"
                label="Title for the new page"
                value={deleted.title}
                onChange={(e) => setDeleted({ ...deleted, title: e.target.value, error: null })}
                slotProps={{ htmlInput: { 'data-wiki-gone-title': '' } }}
              />
              <Button variant="contained" size="small" onClick={() => void saveAsNew()} disabled={deleted.busy || deleted.title.trim() === '' || noAccess} data-wiki-save-new-title>
                {deleted.busy ? 'Saving…' : 'Save as a new page'}
              </Button>
            </Stack>
          )}
        </Alert>
      )}
      {combining && (
        <Suspense fallback={<CircularProgress aria-label="Opening the two versions" />}>
          <Combine
            key={combining.conflict.theirs.blob}
            conflict={combining.conflict}
            busy={combining.busy}
            error={combining.error}
            onSave={(t) => void saveCombined(t)}
            onCancel={() => setCombining(null)}
          />
        </Suspense>
      )}

      <Paper
        variant="outlined"
        sx={{ position: 'sticky', top: layout.topBarHeight, zIndex: 2, display: combining ? 'none' : 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.25, px: 0.5, py: 0.5 }}
        role="toolbar"
        aria-label="Formatting"
      >
        <StylePicker style={blockStyle} onPick={(level) => act(level === 0 ? { kind: 'paragraph' } : { kind: 'heading', level })} />
        <Divider orientation="vertical" flexItem />
        {tool('Bold', <FormatBold fontSize="small" />, () => act({ kind: 'bold' }), `${mod}B`)}
        {tool('Italic', <FormatItalic fontSize="small" />, () => act({ kind: 'italic' }), `${mod}I`)}
        {tool('Strikethrough', <StrikethroughS fontSize="small" />, () => act({ kind: 'strike' }))}
        <Divider orientation="vertical" flexItem />
        {tool('Link', <LinkIcon fontSize="small" />, openLink)}
        <Tooltip title="Wiki link (type [[)">
          <Button size="small" sx={{ minWidth: 0, px: 0.75, fontFamily: 'monospace' }} aria-label="Wiki link" onMouseDown={(e) => e.preventDefault()} onClick={() => act({ kind: 'wikiLink' })}>
            [[ ]]
          </Button>
        </Tooltip>
        <Divider orientation="vertical" flexItem />
        {tool('Bulleted list', <FormatListBulleted fontSize="small" />, () => act({ kind: 'bullet' }))}
        {tool('Numbered list', <FormatListNumbered fontSize="small" />, () => act({ kind: 'ordered' }))}
        {tool('Task list', <Checklist fontSize="small" />, () => act({ kind: 'task' }))}
        {tool('Quote', <FormatQuote fontSize="small" />, () => act({ kind: 'quote' }))}
        <Tooltip title="Callout">
          <IconButton size="small" aria-label="Callout" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setCalloutMenu(e.currentTarget)}>
            <Info fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={calloutMenu} open={!!calloutMenu} onClose={() => setCalloutMenu(null)}>
          {['note', 'tip', 'info', 'warning', 'danger', 'example'].map((type) => (
            <MenuItem key={type} onClick={() => (setCalloutMenu(null), act({ kind: 'callout', type }))}>
              {type[0].toUpperCase() + type.slice(1)}
            </MenuItem>
          ))}
        </Menu>
        {tool('Code block', <Code fontSize="small" />, () => act({ kind: 'code' }))}
        {tool('Table', <TableChart fontSize="small" />, () => act({ kind: 'table' }))}
        {tool('Image', <ImageIcon fontSize="small" />, () => fileInput.current?.click())}
        {tool('YouTube video', <YouTube fontSize="small" />, () => setAsk({ kind: 'youtube', url: '', text: '', textField: 'none', editing: false }))}
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          data-wiki-image-input
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void addImagesRef.current(files);
          }}
        />
        <Box sx={{ ml: 'auto' }}>
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v: Mode | null) => setMode(v)} aria-label="Editor mode">
            <ToggleButton value="visual" sx={{ py: 0.25, px: 1, textTransform: 'none' }}>
              Visual
            </ToggleButton>
            <ToggleButton value="markdown" sx={{ py: 0.25, px: 1, textTransform: 'none' }}>
              Markdown
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Paper>

      {imageError && (
        <Alert severity="error" onClose={() => setImageError(null)} data-wiki-image-error>
          {imageError}
        </Alert>
      )}

      <Box data-wiki-editor-content sx={{ display: combining ? 'none' : undefined }}>
        {mode === 'visual' ? (
          <Box ref={visualHost} sx={[markdownSx, wikiSx, visualSx]} data-wiki-visual-editor />
        ) : (
          <Suspense fallback={<CircularProgress aria-label="Opening the markdown editor" />}>
          <MarkdownEditor
            value={text}
            apiRef={code}
            titles={titles}
            onImageFiles={(files) => void addImagesRef.current(files)}
            onBlockStyle={setBlockStyle}
            onChange={(t) => {
              setText(t);
              setTouched(true);
            }}
          />
          </Suspense>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5, position: { sm: 'sticky' }, bottom: 0, zIndex: 2, display: combining ? 'none' : undefined }} data-wiki-save-bar>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
          <TextField
            size="small"
            label="What did you change?"
            placeholder={`Edited ${source.title}`}
            value={summary}
            onChange={(e) => setSummary(e.target.value.slice(0, MAX_SUMMARY))}
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { 'data-wiki-summary': '', maxLength: MAX_SUMMARY } }}
          />
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={draft}
                  onChange={(e) => {
                    setDraft(e.target.checked);
                    setTouched(true);
                  }}
                  slotProps={{ input: { 'aria-describedby': 'wiki-draft-note', ...({ 'data-wiki-draft-switch': '' } as object) } }}
                />
              }
              label={draft ? 'Draft' : 'Published'}
            />
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              onClick={() => {
                if (!touched || window.confirm(LEAVE)) onClose();
              }}
              disabled={save.status === 'saving'}
            >
              Cancel
            </Button>
            <Button variant="contained" onClick={() => void doSave()} disabled={save.status === 'saving' || noAccess} data-wiki-save>
              {save.status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        </Stack>
        <Typography id="wiki-draft-note" variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
          {draft ? 'Drafts are hidden on the site but visible in the public vault on GitHub.' : 'Saving publishes the page; the site updates about a minute later.'}
        </Typography>
        {save.status === 'failed' && (
          <Alert
            severity="error"
            sx={{ mt: 1 }}
            data-wiki-save-error={save.code}
            action={
              <Button color="inherit" size="small" onClick={() => void copyText()}>
                {copied ? 'Copied' : 'Copy my text'}
              </Button>
            }
          >
            {save.message}
          </Alert>
        )}
      </Paper>

      <PagePicker at={picker} titles={titles} onPick={pickPage} />
      <AskDialog
        ask={ask}
        onClose={() => setAsk(null)}
        onDone={(url, label) => {
          afterAsk.current = ask?.kind === 'youtube' ? () => act({ kind: 'youtube', url }) : () => act({ kind: 'link', href: url, text: label });
          setAsk(null);
        }}
        onRemove={() => {
          afterAsk.current = () => visual.current?.removeLink();
          setAsk(null);
        }}
        onClosing={() => {
          const run = afterAsk.current;
          afterAsk.current = null;
          if (run) run();
          else if (mode === 'visual') visual.current?.focus();
        }}
      />
    </Stack>
  );
}

const STYLES = [
  { level: 0, label: 'Text', short: 'Text', size: '1rem', weight: 400 },
  { level: 1, label: 'Heading 1', short: 'H1', size: '1.75rem', weight: 700 },
  { level: 2, label: 'Heading 2', short: 'H2', size: '1.5rem', weight: 700 },
  { level: 3, label: 'Heading 3', short: 'H3', size: '1.25rem', weight: 700 },
  { level: 4, label: 'Heading 4', short: 'H4', size: '1.05rem', weight: 700 },
];

const styleLabel = (level: BlockStyle) => STYLES.find((s) => s.level === level) ?? { label: `Heading ${level}`, short: `H${level}` };

/**
 * The toolbar's block style picker, as in a word processor: the style of the block at the cursor
 * (Text or Heading 1 to 4; 5 and 6 are shown but not offered), and a menu that sets it, each style
 * shown at about its size on the page, with its markdown and shortcut. On phones the label is short.
 */
function StylePicker({ style, onPick }: { style: BlockStyle; onPick: (level: number) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = (level: number) => (mac ? `⌥⌘${level}` : `Ctrl+Alt+${level}`);
  const current = styleLabel(style);
  return (
    <>
      <Tooltip title="Text style">
        <Button
          size="small"
          color="inherit"
          aria-label={`Text style: ${current.label}`}
          aria-haspopup="menu"
          aria-expanded={anchor ? 'true' : undefined}
          data-wiki-style-picker={style}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => setAnchor(e.currentTarget)}
          endIcon={<ArrowDropDown />}
          sx={{
            textTransform: 'none',
            justifyContent: 'space-between',
            // Wide enough for the longest label, so the toolbar does not move as the cursor does.
            width: { xs: 72, sm: 124 },
            px: 1,
            fontWeight: 400,
            '& .MuiButton-endIcon': { ml: 0.25 },
          }}
        >
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {current.label}
          </Box>
          <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
            {current.short}
          </Box>
        </Button>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ list: { dense: true, 'aria-label': 'Text style' } }}>
        {STYLES.map((s) => (
          <MenuItem
            key={s.level}
            selected={s.level === style}
            data-wiki-style={s.level}
            onClick={() => {
              setAnchor(null);
              onPick(s.level);
            }}
            sx={{ gap: 3, minWidth: 260 }}
          >
            <Box component="span" sx={{ flex: 1, fontSize: s.size, fontWeight: s.weight, lineHeight: 1.3 }}>
              {s.label}
            </Box>
            <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'text.disabled', minWidth: '2.5em' }}>
              {s.level ? '#'.repeat(s.level) : ''}
            </Box>
            <Box component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary', minWidth: '5.5em', textAlign: 'right' }}>
              {shortcut(s.level)}
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** Where the page picker opens; `replace` is the selected wiki link's value it replaces. */
type PickerAt = { left: number; top: number; bottom: number; replace?: string };

/** The URL dialog: a new link or video, or (editing) the link at the cursor. */
type Ask = {
  kind: 'link' | 'youtube';
  url: string;
  text: string;
  /** The link text field: for new linked text, for the edited link's text, or none (a selection). */
  textField: 'insert' | 'edit' | 'none';
  editing: boolean;
};

/** The page picker `[[` opens in the visual editor: published pages and drafts, or any title typed. */
function PagePicker({ at, titles, onPick }: { at: PickerAt | null; titles: () => string[]; onPick: (value: string | null) => void }) {
  const anchor = useMemo(
    () => (at ? { getBoundingClientRect: () => new DOMRect(at.left, at.top, 0, at.bottom - at.top) } : null),
    [at],
  );
  const [input, setInput] = useState('');
  // Choosing closes the list too: answer once.
  const answered = useRef(false);
  useEffect(() => {
    setInput(at?.replace ?? '');
    answered.current = false;
  }, [at]);
  const pick = (value: string | null) => {
    if (answered.current) return;
    answered.current = true;
    onPick(value);
  };
  if (!at || !anchor) return null;
  return (
    <Popper open anchorEl={anchor} placement="bottom-start" sx={{ zIndex: 1500 }}>
      <Paper sx={{ width: 320, p: 1 }} data-wiki-page-picker>
        <Autocomplete
          freeSolo
          openOnFocus
          autoHighlight
          options={titles()}
          inputValue={input}
          onInputChange={(_, v) => setInput(v)}
          onChange={(_, v) => pick(typeof v === 'string' ? v : null)}
          onClose={(_, reason) => {
            if (reason === 'escape') pick(null);
            else if (reason === 'blur') pick(input.trim() ? input : null);
          }}
          renderInput={(params) => <TextField {...params} autoFocus size="small" placeholder="Link to a page" />}
        />
      </Paper>
    </Popper>
  );
}

function AskDialog({
  ask,
  onClose,
  onDone,
  onRemove,
  onClosing,
}: {
  ask: Ask | null;
  onClose: () => void;
  onDone: (url: string, label: string) => void;
  onRemove: () => void;
  /** The dialog starts to close (answered or cancelled). */
  onClosing: () => void;
}) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => {
    setUrl(ask?.url ?? '');
    setLabel(ask?.text ?? '');
  }, [ask]);
  const kind = ask?.kind;
  const valid = kind === 'youtube' ? !!youtubeVideo(url) : /^(https?:\/\/|mailto:|\/|#)\S+$/i.test(url.trim());
  return (
    <Dialog open={!!ask} onClose={onClose} fullWidth maxWidth="xs" disableRestoreFocus slotProps={{ paper: { ...({ 'data-wiki-link-dialog': kind ?? '' } as object) }, transition: { onExit: onClosing } }}>
      <DialogTitle>{kind === 'youtube' ? 'YouTube video' : ask?.editing ? 'Edit link' : 'Link'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            label={kind === 'youtube' ? 'Video URL' : 'URL'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            error={url !== '' && !valid}
            helperText={url !== '' && !valid ? (kind === 'youtube' ? 'A youtube.com or youtu.be link.' : 'A full address, starting with https://.') : ' '}
            slotProps={{ htmlInput: { 'data-wiki-link-url': '' } }}
          />
          {kind === 'link' && ask?.textField !== 'none' && (
            <TextField
              label={ask?.textField === 'edit' ? 'Text' : 'Text (if nothing is selected)'}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              slotProps={{ htmlInput: { 'data-wiki-link-text': '' } }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {ask?.editing && (
          <Button color="error" onClick={onRemove} sx={{ mr: 'auto' }} data-wiki-link-remove>
            Remove link
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={() => onDone(url.trim(), label.trim())} data-wiki-link-done>
          {ask?.editing ? 'Save' : 'Insert'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default WikiEditor;
