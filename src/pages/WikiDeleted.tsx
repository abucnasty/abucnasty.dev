// /wiki/deleted, for wiki editors: pages deleted in the last 90 days (on the site or in Obsidian),
// with who deleted them and when, and Restore: the page as it was before it was deleted, at its old
// address. When its title has been taken since, it can be restored under another title.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { PageHeader } from '../components/PageHeader';
import { WikiFooter, WikiSignInNotice } from '../components/WikiAccess';
import { WikiLoading } from '../components/WikiStates';
import { editingOff, isEditor, signInUrl, useWikiSession } from '../wikiAuth';
import { rememberSaved } from '../wikiSaved';
import { titleClash, titleProblem } from '../wikiSource';
import { loadDeleted, SaveError, undeletePage, type DeletedPage } from '../wikiPagesApi';
import { WIKI_ALL_ROUTE, useWikiIndex, wikiRoute, wikiSlug } from '../wiki';
import { editDate } from '../format';

type Load = { status: 'loading' } | { status: 'ready'; pages: DeletedPage[]; partial: boolean } | { status: 'failed'; message: string };

export function WikiDeleted() {
  const session = useWikiSession();
  const editor = isEditor(session);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [restoring, setRestoring] = useState<DeletedPage | null>(null);
  const [done, setDone] = useState<{ title: string; slug: string; draft: boolean } | null>(null);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!editor) return;
    let live = true;
    setLoad({ status: 'loading' });
    loadDeleted().then(
      (d) => live && setLoad({ status: 'ready', pages: d.pages, partial: d.partial }),
      (err) => live && setLoad({ status: 'failed', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [editor, attempt]);

  const header = <PageHeader overline="Wiki" title="Recently deleted" meta="The last 90 days" actions={<Button component={RouterLink} to={WIKI_ALL_ROUTE} size="small">All pages</Button>} />;
  if (session.status === 'loading') return <WikiLoading label="Loading" />;
  if (!editor) {
    return (
      <Stack spacing={2}>
        <WikiSignInNotice />
        {header}
        <Alert severity="info" action={session.status === 'signed-out' ? <Button color="inherit" size="small" href={signInUrl('/wiki/deleted')}>Sign in</Button> : undefined}>
          Deleted pages are for wiki editors.
        </Alert>
        <WikiFooter />
      </Stack>
    );
  }
  const off = editingOff(session);
  return (
    <Stack spacing={2}>
      {header}
      {done && (
        <Alert
          severity="success"
          onClose={() => setDone(null)}
          data-wiki-undeleted
          action={
            <Button color="inherit" size="small" component={RouterLink} to={wikiRoute(done.slug)}>
              Open it
            </Button>
          }
        >
          Restored {done.title}. {done.draft ? 'Wiki editors will see it' : 'The site shows it'} in about a minute.
        </Alert>
      )}
      {load.status === 'loading' && <WikiLoading label="Loading deleted pages" />}
      {load.status === 'failed' && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>Try again</Button>}>
          {load.message}
        </Alert>
      )}
      {load.status === 'ready' && load.pages.length === 0 && <Typography sx={{ color: 'text.secondary' }}>No pages were deleted in the last 90 days.</Typography>}
      {load.status === 'ready' && load.pages.length > 0 && (
        <Box sx={{ backgroundColor: 'background.paper', borderTop: 1, borderColor: 'divider' }} data-wiki-deleted-list>
          {load.pages.map((p) => {
            const button = (
              <Button size="small" variant="outlined" onClick={() => setRestoring(p)} disabled={!!off} data-wiki-undelete>
                Restore
              </Button>
            );
            return (
              <Box key={p.path} data-wiki-deleted-page={p.path} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, px: 1.25, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ flex: '1 1 16rem', minWidth: 0 }}>
                  <Box sx={{ fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere' }}>{p.title}</Box>
                  <Box sx={{ fontSize: 12.5, color: 'text.secondary', overflowWrap: 'anywhere' }}>
                    {p.folder ? `${p.folder.split('/').join(' / ')} · ` : ''}deleted by {p.author || 'unknown'} · {editDate(p.date)}
                    {p.titleTaken ? ` · "${p.titleTaken}" has its title now` : ''}
                  </Box>
                </Box>
                {off ? (
                  <Tooltip title={off}>
                    <span>{button}</span>
                  </Tooltip>
                ) : (
                  button
                )}
              </Box>
            );
          })}
        </Box>
      )}
      {load.status === 'ready' && load.partial && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Not every change could be checked this time, so some pages may be missing. Reload in a minute.
        </Typography>
      )}
      <UndeleteDialog
        page={restoring}
        onClose={() => setRestoring(null)}
        onDone={(r) => {
          setRestoring(null);
          setDone(r);
          retry();
        }}
      />
      <WikiFooter />
    </Stack>
  );
}

function UndeleteDialog({ page, onClose, onDone }: { page: DeletedPage | null; onClose: () => void; onDone: (r: { title: string; slug: string; draft: boolean }) => void }) {
  const state = useWikiIndex();
  const [title, setTitle] = useState('');
  const [needTitle, setNeedTitle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTitle(page ? `${page.title} (restored)` : '');
    setNeedTitle(!!page?.titleTaken);
    setError(null);
  }, [page]);
  const taken = useMemo(() => state.index?.pages.flatMap((p) => [p.title, ...p.aliases]) ?? [], [state.index]);
  const t = title.trim();
  const problem = !needTitle ? null : t === '' ? 'Give the page a title.' : titleProblem(t) ?? (titleClash(t, taken) ? `There's already a page called "${titleClash(t, taken)}".` : null);
  const restore = async () => {
    if (!page || problem) return;
    setBusy(true);
    setError(null);
    try {
      const r = await undeletePage({ path: page.path, commit: page.commit, ...(needTitle ? { title: t } : {}) });
      rememberSaved({
        meta: { title: r.title, slug: r.slug, folder: r.folder ?? page.folder, aliases: [], headings: [], excerpt: '', links: [], files: [], blob: r.blob ?? '', draft: r.draft },
        body: r.body ?? '',
        files: [],
        draft: r.draft,
        created: true,
        at: Date.now(),
      });
      onDone({ title: r.title, slug: r.slug, draft: r.draft });
    } catch (err) {
      if (err instanceof SaveError && err.code === 'title_taken') setNeedTitle(true);
      setError(err instanceof SaveError ? err.message : 'Restoring failed. Nothing was changed; try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!page} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" data-wiki-undelete-dialog>
      <DialogTitle>Restore {page?.title}?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: needTitle ? 2 : 0 }}>
          {needTitle
            ? `"${page?.title}" is taken by another page now. Restore it under a different title, in the same folder.`
            : `It comes back as it was before it was deleted, at its old address${page?.folder ? ` in ${page.folder.split('/').join(' / ')}` : ''}.`}
        </DialogContentText>
        {needTitle && (
          <TextField
            fullWidth
            autoFocus
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={!!problem}
            helperText={problem ?? (t ? `abucnasty.dev${wikiRoute(wikiSlug(t))}` : ' ')}
            slotProps={{ htmlInput: { 'data-wiki-undelete-title': '', maxLength: 100 } }}
          />
        )}
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
        <Button variant="contained" onClick={() => void restore()} disabled={busy || !!problem} data-wiki-undelete-confirm>
          {busy ? 'Restoring…' : 'Restore'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default WikiDeleted;
