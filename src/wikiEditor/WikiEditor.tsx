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
import Title from '@mui/icons-material/Title';
import { markdownSx } from '../components/MarkdownRenderer';
import { wikiSx } from '../components/WikiMarkdown';
import { layout } from '../layout';
import { findWikiTarget, resolveWikiFile, wikiFileUrl, youtubeVideo, type WikiIndex } from '../wikiCore';
import { rememberSaved } from '../wikiSaved';
import { isEditor, useWikiSession } from '../wikiAuth';
import { MAX_SUMMARY } from '../wikiSource';
import { loadSource, savePage, SaveError, type PageSource, type SaveResult } from './api';
import { ImageError, prepareImage, type PreparedImage } from './images';
import type { MarkdownAction } from './MarkdownEditor';
import { createVisualEditor, type VisualEditor, type WikiLookup } from './milkdown';

// CodeMirror comes in its own chunk, the first time Markdown mode opens.
const MarkdownEditor = lazy(() => import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })));

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
  const [picker, setPicker] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const [ask, setAsk] = useState<null | 'link' | 'youtube'>(null);
  const [headingMenu, setHeadingMenu] = useState<HTMLElement | null>(null);
  const [calloutMenu, setCalloutMenu] = useState<HTMLElement | null>(null);

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
    if (value && value.trim() !== '') v.insertWikiLink(value.trim());
    else {
      // Cancelled: put back what was typed.
      const view = v.view();
      view.dispatch(view.state.tr.insertText('[['));
      view.focus();
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
    // Only images still on the page go up.
    const used = [...images.current.values()].filter((i) => body.includes(`![[${i.name}`));
    setSave({ status: 'saving' });
    setCopied(false);
    try {
      const result = await savePage({ source, body, draft, summary, images: used.map((i) => ({ name: i.name, blob: i.blob })) });
      setTouched(false);
      if (!result.unchanged) {
        const files = (result.images ?? []).map((i) => ({
          path: i.path.replace(/^wiki\//, ''),
          published: '',
          type: '',
          size: 0,
          v: i.oid,
          url: `/api/wiki/image/${i.oid}`,
        }));
        const old = index.pages.find((p) => p.slug === result.slug);
        rememberSaved({
          meta: {
            ...(old ?? { aliases: [], headings: [], excerpt: '', links: [], files: [] }),
            title: result.title,
            slug: result.slug,
            folder: result.folder,
            blob: result.blob,
            draft: result.draft,
          },
          body,
          files,
          draft: result.draft,
          created: !!result.created,
          at: Date.now(),
        });
      }
      onSaved(result);
    } catch (err) {
      const e = err instanceof SaveError ? err : new SaveError(0, 'error', 'Saving failed. Nothing was saved; try again.');
      setSave({ status: 'failed', code: e.code, message: e.message });
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
    <Stack spacing={2} data-wiki-editor data-mode={mode}>
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

      <Paper
        variant="outlined"
        sx={{ position: 'sticky', top: layout.topBarHeight, zIndex: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.25, px: 0.5, py: 0.5 }}
        role="toolbar"
        aria-label="Formatting"
      >
        <Tooltip title="Headings">
          <IconButton size="small" aria-label="Headings" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setHeadingMenu(e.currentTarget)}>
            <Title fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={headingMenu} open={!!headingMenu} onClose={() => setHeadingMenu(null)}>
          {[1, 2, 3].map((level) => (
            <MenuItem key={level} onClick={() => (setHeadingMenu(null), act({ kind: 'heading', level }))}>
              Heading {level}
            </MenuItem>
          ))}
          <MenuItem onClick={() => (setHeadingMenu(null), act({ kind: 'paragraph' }))}>Plain text</MenuItem>
        </Menu>
        {tool('Bold', <FormatBold fontSize="small" />, () => act({ kind: 'bold' }), `${mod}B`)}
        {tool('Italic', <FormatItalic fontSize="small" />, () => act({ kind: 'italic' }), `${mod}I`)}
        {tool('Strikethrough', <StrikethroughS fontSize="small" />, () => act({ kind: 'strike' }))}
        <Divider orientation="vertical" flexItem />
        {tool('Link', <LinkIcon fontSize="small" />, () => setAsk('link'))}
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
        {tool('YouTube video', <YouTube fontSize="small" />, () => setAsk('youtube'))}
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

      <Box data-wiki-editor-content>
        {mode === 'visual' ? (
          <Box ref={visualHost} sx={[markdownSx, wikiSx, visualSx]} data-wiki-visual-editor />
        ) : (
          <Suspense fallback={<CircularProgress aria-label="Opening the markdown editor" />}>
          <MarkdownEditor
            value={text}
            apiRef={code}
            titles={titles}
            onImageFiles={(files) => void addImagesRef.current(files)}
            onChange={(t) => {
              setText(t);
              setTouched(true);
            }}
          />
          </Suspense>
        )}
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5, position: { sm: 'sticky' }, bottom: 0, zIndex: 2 }} data-wiki-save-bar>
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
        kind={ask}
        onClose={() => setAsk(null)}
        onDone={(url, label) => {
          setAsk(null);
          if (ask === 'youtube') act({ kind: 'youtube', url });
          else act({ kind: 'link', href: url, text: label });
        }}
      />
    </Stack>
  );
}

/** The page picker `[[` opens in the visual editor: published pages and drafts, or any title typed. */
function PagePicker({ at, titles, onPick }: { at: { left: number; top: number; bottom: number } | null; titles: () => string[]; onPick: (value: string | null) => void }) {
  const anchor = useMemo(
    () => (at ? { getBoundingClientRect: () => new DOMRect(at.left, at.top, 0, at.bottom - at.top) } : null),
    [at],
  );
  const [input, setInput] = useState('');
  // Choosing closes the list too: answer once.
  const answered = useRef(false);
  useEffect(() => {
    setInput('');
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

function AskDialog({ kind, onClose, onDone }: { kind: null | 'link' | 'youtube'; onClose: () => void; onDone: (url: string, label: string) => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => {
    setUrl('');
    setLabel('');
  }, [kind]);
  const valid = kind === 'youtube' ? !!youtubeVideo(url) : /^(https?:\/\/|mailto:|\/|#)\S+$/i.test(url.trim());
  return (
    <Dialog open={!!kind} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{kind === 'youtube' ? 'YouTube video' : 'Link'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            label={kind === 'youtube' ? 'Video URL' : 'URL'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            error={url !== '' && !valid}
            helperText={url !== '' && !valid ? (kind === 'youtube' ? 'A youtube.com or youtu.be link.' : 'A full address, starting with https://.') : ' '}
          />
          {kind === 'link' && <TextField label="Text (if nothing is selected)" value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={() => onDone(url.trim(), label.trim())}>
          Insert
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default WikiEditor;
