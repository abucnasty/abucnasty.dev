// /wiki/<slug>/history: a page's edits, newest first, across its renames (worker/wikiHistory.ts):
// when, who (the editor's name; never an email) and the summary. Anyone sees a published page's
// list; a draft's is for editors only. Editors also see what each edit changed (side by side; on a
// phone in one column) and can restore an older version: saved as a new edit, never rewriting
// the history.
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Stack, Tooltip, Typography } from '@mui/material';
import { PageHeader } from '../components/PageHeader';
import { editDate } from '../format';
import { DraftChip, WikiFooter } from '../components/WikiAccess';
import { WikiLoadFailed, WikiLoading, WikiPageNotFound } from '../components/WikiStates';
import { editingOff, isEditor, useWikiSession, type WikiSession } from '../wikiAuth';
import { movedTo, rememberSaved, savedPage, useSavedPages } from '../wikiSaved';
import { wikiPagePath } from '../wikiSource';
import { loadSource } from '../wikiEditor/api';
import { loadHistory, loadVersion, restoreVersion, SaveError, type HistoryEntry, type PageHistory } from '../wikiPagesApi';
import { findWikiAlias, findWikiPage, useWikiIndex, wikiHistoryRoute, wikiRoute, type WikiPageMeta } from '../wiki';

// The diff view (CodeMirror's merge view) is its own chunk, fetched when an editor opens a diff.
const WikiDiff = lazy(() => import('../components/WikiDiff'));

const VAULT_COMMITS = 'https://github.com/abucnasty/factorio-vault/commits/main/';

const titleOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

type Notice = { severity: 'success' | 'info'; text: string };
type Load = { status: 'loading' } | { status: 'ready'; history: PageHistory } | { status: 'failed'; message: string };

export function WikiHistory() {
  const { slug = '' } = useParams();
  const state = useWikiIndex();
  const session = useWikiSession();
  useSavedPages();
  const moved = movedTo(slug);
  const page = savedPage(slug)?.meta ?? (state.index ? findWikiPage(state.index, slug) : undefined);
  const path = page ? wikiPagePath(page) : null;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<Notice | null>(null);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    let live = true;
    // Read again after a restore: the list stays until the new one is here.
    setLoad((l) => (l.status === 'ready' && l.history.path === path ? l : { status: 'loading' }));
    loadHistory(path).then(
      (history) => live && setLoad({ status: 'ready', history }),
      (err) => live && setLoad({ status: 'failed', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [path, attempt]);

  if (moved) return <Navigate to={wikiHistoryRoute(moved)} replace />;
  if (state.status === 'loading') return <WikiLoading label="Loading the history" />;
  if (state.status === 'failed') return <WikiLoadFailed what="The wiki" onRetry={state.retry} />;
  if (!page) {
    const to = findWikiAlias(state.index, slug);
    if (to) return <Navigate to={wikiHistoryRoute(to.slug)} replace />;
    if (state.draftsPending) return <WikiLoading label="Loading the history" />;
    return (
      <Stack spacing={2}>
        <WikiPageNotFound slug={slug} />
        <WikiFooter />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <PageHeader
        overline={['Wiki', ...(page.folder ? page.folder.split('/') : []), 'History'].join(' / ')}
        title={page.title}
        meta={page.draft ? <DraftChip /> : undefined}
        actions={
          <Button component={RouterLink} to={wikiRoute(page.slug)} size="small" variant="outlined" data-wiki-history-back>
            Back to the page
          </Button>
        }
      />
      {done && (
        <Alert
          severity={done.severity}
          onClose={() => setDone(null)}
          data-wiki-restored
          action={
            <Button color="inherit" size="small" component={RouterLink} to={wikiRoute(page.slug)}>
              View the page
            </Button>
          }
        >
          {done.text}
        </Alert>
      )}
      {(load.status === 'loading' || (load.status === 'ready' && load.history.path !== path)) && <WikiLoading label="Loading the history" />}
      {load.status === 'failed' && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>Try again</Button>}>
          {load.message}
        </Alert>
      )}
      {load.status === 'ready' && load.history.path === path && <HistoryList page={page} history={load.history} session={session} onRestored={(n) => (setDone(n), retry())} />}
      <WikiFooter />
    </Stack>
  );
}

function HistoryList({ page, history, session, onRestored }: { page: WikiPageMeta; history: PageHistory; session: WikiSession; onRestored: (n: Notice) => void }) {
  const editor = isEditor(session);
  const [open, setOpen] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<HistoryEntry | null>(null);
  const { entries } = history;
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {entries.length} {entries.length === 1 ? 'edit' : 'edits'}, newest first.
        {editor ? ' Open an edit to see what it changed.' : ''}
      </Typography>
      <Box sx={{ backgroundColor: 'background.paper', borderTop: 1, borderColor: 'divider' }} data-wiki-history>
        {entries.map((e, i) => (
          <HistoryRow
            key={e.sha}
            entry={e}
            older={entries[i + 1] ?? null}
            first={i === entries.length - 1 && !history.truncated}
            current={i === 0}
            editor={editor}
            off={editingOff(session)}
            open={open === e.sha}
            onToggle={() => setOpen(open === e.sha ? null : e.sha)}
            onRestore={() => setRestoring(e)}
          />
        ))}
      </Box>
      {history.truncated && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Older edits are in{' '}
          <Link href={`${VAULT_COMMITS}${history.path.split('/').map(encodeURIComponent).join('/')}`} target="_blank" rel="noopener noreferrer">
            the vault's history on GitHub
          </Link>
          .
        </Typography>
      )}
      <RestoreDialog
        page={page}
        entry={restoring}
        onClose={() => setRestoring(null)}
        onDone={(text, severity) => {
          setRestoring(null);
          setOpen(null);
          window.scrollTo({ top: 0 });
          onRestored({ text, severity });
        }}
      />
    </Stack>
  );
}

function HistoryRow(props: {
  entry: HistoryEntry;
  older: HistoryEntry | null;
  /** The page's first commit (nothing before it). */
  first: boolean;
  /** The newest edit: the page as it is now. */
  current: boolean;
  editor: boolean;
  off: string | null;
  open: boolean;
  onToggle: () => void;
  onRestore: () => void;
}) {
  const { entry: e, editor, open } = props;
  const label =
    e.kind === 'renamed' && e.from ? `Renamed from ${titleOf(e.from)}` : e.kind === 'restored' && e.from ? `Restored from ${titleOf(e.from)}` : e.kind === 'restored' ? 'Restored' : e.kind === 'deleted' ? 'Deleted' : null;
  const canRestore = editor && !props.current && e.kind !== 'deleted';
  const restore = (
    <Button size="small" variant="outlined" onClick={props.onRestore} disabled={!!props.off} data-wiki-restore-version>
      Restore this version
    </Button>
  );
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 1.25, py: 1 }} data-wiki-history-entry={e.sha}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5 }}>
        <Box sx={{ flex: '1 1 16rem', minWidth: 0 }}>
          <Box sx={{ fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere' }}>{e.summary || '(no summary)'}</Box>
          <Box sx={{ fontSize: 12.5, color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {e.author || 'Unknown'} · {editDate(e.date)}
            {props.current ? ' · current version' : ''}
          </Box>
        </Box>
        {label && <Chip size="small" variant="outlined" label={label} />}
        {editor && (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button size="small" onClick={props.onToggle} aria-expanded={open} data-wiki-show-diff>
              {open ? 'Hide changes' : 'Changes'}
            </Button>
            {canRestore && (props.off ? <Tooltip title={props.off}><span>{restore}</span></Tooltip> : restore)}
          </Stack>
        )}
      </Box>
      {editor && open && <EntryDiff entry={e} older={props.older} first={props.first} />}
    </Box>
  );
}

type Versions = { status: 'loading' } | { status: 'ready'; before: string; after: string } | { status: 'failed'; message: string };

/** This edit against the version before it (an empty page before the first edit). */
function EntryDiff({ entry, older, first }: { entry: HistoryEntry; older: HistoryEntry | null; first: boolean }) {
  const [v, setV] = useState<Versions>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    const before = older ? loadVersion(older.path, older.sha) : Promise.resolve(first ? '' : null);
    Promise.all([before, loadVersion(entry.path, entry.sha)]).then(
      ([b, a]) => live && (b === null ? setV({ status: 'failed', message: 'The version before this one is older than the history shown here.' }) : setV({ status: 'ready', before: b, after: a })),
      (err) => live && setV({ status: 'failed', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [entry, older, first]);
  return (
    <Box sx={{ mt: 1 }}>
      {v.status === 'loading' && <CircularProgress size={24} aria-label="Loading the changes" />}
      {v.status === 'failed' && <Alert severity="error">{v.message}</Alert>}
      {v.status === 'ready' && (
        <Suspense fallback={<CircularProgress size={24} aria-label="Loading the changes" />}>
          {v.before === v.after ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The text didn't change in this edit.
            </Typography>
          ) : (
            <WikiDiff before={v.before} after={v.after} />
          )}
        </Suspense>
      )}
    </Box>
  );
}

function RestoreDialog({ page, entry, onClose, onDone }: { page: WikiPageMeta; entry: HistoryEntry | null; onClose: () => void; onDone: (text: string, severity: 'success' | 'info') => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [entry]);
  const restore = async () => {
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      const source = await loadSource(page.slug);
      const r = await restoreVersion({ path: source.path!, base: source.blob!, commit: entry.sha, from: entry.path });
      if (r.unchanged) {
        onDone("That version's text is the page's text now, so nothing was saved.", 'info');
        return;
      }
      rememberSaved({ meta: { ...page, blob: r.blob ?? page.blob, draft: r.draft }, body: r.body ?? '', files: [], draft: r.draft, created: false, at: Date.now() });
      onDone(r.draft ? 'Restored as a new edit. Wiki editors will see it in about a minute.' : 'Restored as a new edit. The site updates in about a minute.', 'success');
    } catch (err) {
      setError(err instanceof SaveError ? err.message : 'Restoring failed. Nothing was changed; try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!entry} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" data-wiki-restore-dialog>
      <DialogTitle>Restore this version?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          The page's text goes back to the version from {entry ? editDate(entry.date) : ''}, saved as a new edit. Its title, draft setting and former titles stay as they are now. Nothing in the history is removed.
        </DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} data-wiki-restore-error>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void restore()} disabled={busy} data-wiki-restore-confirm>
          {busy ? 'Restoring…' : 'Restore'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default WikiHistory;
