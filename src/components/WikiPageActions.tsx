// A page's menu for wiki editors, beside Edit: rename or move the page, and delete it (with a
// confirm step). The front page (Home) can do neither. Both are one commit on the vault's main
// branch through the Worker's checks (worker/wikiPages.ts); the page shows the change at once and
// the site catches up about a minute later. Its own chunk: readers never download it.
import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import MoreVert from '@mui/icons-material/MoreVert';
import { WIKI_HOME, wikiRoute, wikiSlug, type WikiIndex, type WikiPageMeta } from '../wikiCore';
import { existingFolder, MAX_FOLDER, MAX_SUMMARY, pageFolderProblem, tidyFolder, titleClash, titleProblem } from '../wikiSource';
import { rememberDeleted, rememberMoved } from '../wikiSaved';
import { loadSource } from '../wikiEditor/api';
import { deletePage, renamePage, SaveError } from '../wikiPagesApi';

/** Router state a renamed page opens with: what to tell the editor. */
export interface NoticeState {
  notice?: string;
}

interface Props {
  index: WikiIndex;
  page: WikiPageMeta;
  /** The page's markdown as shown, kept on screen at the new address until the site updates. */
  markdown: string | null;
  /** Why changing pages is off now, or null. */
  off: string | null;
}

export function WikiPageActions({ index, page, markdown, off }: Props) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const home = page.slug === WIKI_HOME;
  const why = off ?? (home ? "The front page can't be renamed or deleted." : null);
  const button = (
    <IconButton size="small" aria-label="More page actions" onClick={(e) => setMenu(e.currentTarget)} disabled={!!why} data-wiki-page-menu>
      <MoreVert fontSize="small" />
    </IconButton>
  );
  return (
    <>
      {why ? (
        <Tooltip title={why}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => (setMenu(null), setDialog('rename'))} data-wiki-rename>
          Rename or move…
        </MenuItem>
        <MenuItem onClick={() => (setMenu(null), setDialog('delete'))} sx={{ color: 'error.main' }} data-wiki-delete>
          Delete…
        </MenuItem>
      </Menu>
      {dialog === 'rename' && <RenameDialog index={index} page={page} markdown={markdown} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteDialog page={page} onClose={() => setDialog(null)} />}
    </>
  );
}

const failed = (err: unknown) => (err instanceof SaveError ? err.message : "That didn't work. Nothing was changed; try again.");

function RenameDialog({ index, page, markdown, onClose }: { index: WikiIndex; page: WikiPageMeta; markdown: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(page.title);
  const [folderInput, setFolderInput] = useState(page.folder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folders = useMemo(() => {
    const all = new Set<string>();
    for (const p of index.pages) {
      const parts = p.folder === '' ? [] : p.folder.split('/');
      for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
    }
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [index]);
  const folder = existingFolder(tidyFolder(folderInput), folders);
  const folderIssue = pageFolderProblem(folder, folders);
  const taken = useMemo(() => index.pages.filter((p) => p.slug !== page.slug).flatMap((p) => [p.title, ...p.aliases]), [index, page.slug]);
  const t = title.trim();
  const clash = t === '' ? null : titleClash(t, taken);
  const problem = t === '' ? null : titleProblem(t) ?? (clash ? `There's already a page called "${clash}" (or one with the same address or former title).` : null);
  const same = t === page.title && folder === page.folder;
  const retitled = t.toLowerCase() !== page.title.toLowerCase();

  const rename = async () => {
    if (t === '' || problem || folderIssue || same) return;
    setBusy(true);
    setError(null);
    try {
      const source = await loadSource(page.slug);
      const r = await renamePage({ path: source.path!, base: source.blob!, title: t, folder });
      const aliases = retitled && !page.aliases.some((a) => a.toLowerCase() === page.title.toLowerCase()) ? [...page.aliases, page.title] : page.aliases;
      const notice: NoticeState = { notice: `Renamed. ${r.draft ? 'Wiki editors will see the new address' : 'The site updates'} in about a minute; the old title keeps leading here.` };
      // Be at the new address before the move is known: the page at the old one would redirect
      // there itself, without the notice.
      flushSync(() => navigate(wikiRoute(r.slug), { state: notice }));
      rememberMoved(page.slug, {
        meta: { ...page, title: r.title, slug: r.slug, folder: r.folder ?? folder, blob: r.blob ?? page.blob, draft: r.draft, aliases },
        body: markdown ?? '',
        files: [],
        draft: r.draft,
        created: false,
        at: Date.now(),
      });
    } catch (err) {
      setError(failed(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-wiki-rename-dialog>
      <DialogTitle>Rename or move</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          The title is the page's name and address. The old title keeps working: its address and [[links]] to it lead here. Folders only organise the vault.
        </DialogContentText>
        <Stack spacing={2}>
          <TextField
            autoFocus
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void rename()}
            error={!!problem}
            helperText={problem ?? (t ? `abucnasty.dev${wikiRoute(wikiSlug(t))}` : ' ')}
            slotProps={{ htmlInput: { 'data-wiki-rename-title': '', maxLength: 100 } }}
          />
          <Autocomplete
            freeSolo
            options={folders}
            inputValue={folderInput}
            onInputChange={(_, v) => setFolderInput(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Folder"
                placeholder="Top level, or pick or type one"
                error={!!folderIssue}
                helperText={folderIssue ?? (folder === '' ? 'Empty: the top level.' : folders.includes(folder) ? `In ${folder.split('/').join(' / ')}` : `A new folder: ${folder.split('/').join(' / ')}`)}
                inputProps={{ ...params.inputProps, 'data-wiki-rename-folder': '', maxLength: MAX_FOLDER }}
              />
            )}
          />
          {error && (
            <Alert severity="error" data-wiki-change-error>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void rename()} disabled={busy || t === '' || !!problem || !!folderIssue || same} data-wiki-rename-confirm>
          {busy ? 'Renaming…' : 'Rename'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeleteDialog({ page, onClose }: { page: WikiPageMeta; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const source = await loadSource(page.slug);
      await deletePage({ path: source.path!, base: source.blob!, summary: reason.trim() });
      rememberDeleted(page.slug);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(failed(err));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" data-wiki-delete-dialog>
      <DialogTitle>Delete {page.title}?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          It leaves the site in about a minute. Wiki editors can restore it from Recently deleted for 90 days; its images are kept. Links to it will show as missing.
        </DialogContentText>
        <TextField
          fullWidth
          size="small"
          label="Why? (optional)"
          placeholder={`Deleted ${page.title}`}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, MAX_SUMMARY))}
          slotProps={{ htmlInput: { 'data-wiki-delete-reason': '', maxLength: MAX_SUMMARY } }}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} data-wiki-change-error>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={() => void remove()} disabled={busy} data-wiki-delete-confirm>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default WikiPageActions;
