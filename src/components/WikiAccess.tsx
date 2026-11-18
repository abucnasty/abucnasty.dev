import { useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Typography } from '@mui/material';
import { socials } from './SocialLinks';
import { useWikiIndex } from '../wiki';
import { acknowledgeFirstSignIn, loadWikiSession, signInUrl, signOut, SIGNIN_OUTCOMES, SIGNIN_PARAM, useWikiSession, type WikiMe } from '../wikiAuth';
import { findWikiTarget, wikiRoute } from '../wikiCore';

// The wiki's sign-in pieces: the footer every wiki page ends with ("Maintainer sign-in", or who is
// signed in and "Sign out"), the notice after a sign-in that did not complete, the editors'
// first-sign-in notice, and the marks drafts carry. Signing in itself happens on Discord's page.

/** The wiki page that explains editing; linked from the first-sign-in notice only once it exists. */
const HOW_TO_EDIT = 'How to edit the wiki';

/** "Draft", next to a draft's title or a link to one. */
export function DraftChip({ size = 'small' }: { size?: 'small' | 'medium' }) {
  return <Chip label="Draft" size={size} color="warning" variant="outlined" data-wiki-draft sx={{ height: size === 'small' ? 20 : undefined, fontSize: 12, fontWeight: 600 }} />;
}

/** At the top of a draft. */
export function DraftBanner() {
  return (
    <Alert severity="warning" data-wiki-draft-banner>
      Draft — only wiki editors can see this.
    </Alert>
  );
}

/** After the Worker sent the visitor back from a sign-in that did not complete (`?wiki-signin=`). */
export function WikiSignInNotice() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const outcome = params.get(SIGNIN_PARAM);
  if (!outcome) return null;
  const dismiss = () => {
    params.delete(SIGNIN_PARAM);
    const q = params.toString();
    navigate(`${pathname}${q ? `?${q}` : ''}${hash}`, { replace: true });
  };
  return (
    <Alert severity={outcome === 'cancelled' ? 'info' : 'error'} onClose={dismiss} data-wiki-signin-outcome={outcome}>
      {SIGNIN_OUTCOMES[outcome] ?? SIGNIN_OUTCOMES.failed}
    </Alert>
  );
}

function Who({ me }: { me: WikiMe }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      {me.avatarUrl && <Avatar src={me.avatarUrl} alt="" sx={{ width: 24, height: 24 }} slotProps={{ img: { referrerPolicy: 'no-referrer' } }} />}
      <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} data-wiki-user>
        {me.displayName}
      </Typography>
    </Box>
  );
}

/** The one-time notice for an editor's first sign-in on this device. */
function FirstSignInDialog({ me }: { me: WikiMe }) {
  const wiki = useWikiIndex();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const guide = wiki.index ? findWikiTarget(wiki.index, HOW_TO_EDIT) : undefined;
  const ok = () => {
    setBusy(true);
    acknowledgeFirstSignIn().then(
      () => setBusy(false),
      () => (setBusy(false), setFailed(true)),
    );
  };
  return (
    <Dialog open aria-labelledby="wiki-first-signin-title" data-wiki-first-signin>
      <DialogTitle id="wiki-first-signin-title">Welcome, wiki editor</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Your Discord server display name, <strong>{me.displayName}</strong>, will be shown publicly on the wiki edits you make.
        </DialogContentText>
        {guide && !guide.draft && (
          <DialogContentText sx={{ mt: 2 }}>
            Read{' '}
            <Link component={RouterLink} to={wikiRoute(guide.slug)}>
              {guide.title}
            </Link>{' '}
            before you start.
          </DialogContentText>
        )}
        {failed && (
          <Alert severity="error" sx={{ mt: 2 }}>
            That didn't save. Try again.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={ok} disabled={busy}>
          I understand
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The end of every wiki page: the maintainers' sign-in, or who is signed in. */
export function WikiFooter() {
  const session = useWikiSession();
  const { pathname, search, hash } = useLocation();
  const [signOutFailed, setSignOutFailed] = useState(false);
  const out = () => {
    setSignOutFailed(false);
    signOut().catch(() => setSignOutFailed(true));
  };
  const signOutButton = (
    <Button size="small" variant="text" onClick={out}>
      Sign out
    </Button>
  );
  // The address to come back to, without a previous sign-in's outcome.
  const params = new URLSearchParams(search);
  params.delete(SIGNIN_PARAM);
  const q = params.toString();
  const here = `${pathname}${q ? `?${q}` : ''}${hash}`;

  return (
    <Box
      component="aside"
      aria-label="Wiki maintainers"
      data-wiki-footer
      sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5, mt: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 1 }}
    >
      {session.status === 'loading' && <Box sx={{ height: 30 }} />}
      {session.status === 'signed-out' && (
        <Link href={signInUrl(here)} variant="body2" color="text.secondary" underline="hover" data-wiki-signin>
          Maintainer sign-in
        </Link>
      )}
      {session.status === 'signed-in' && (
        <>
          <Who me={session.me} />
          {session.me.editor ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Wiki editor
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }} data-wiki-no-access>
              You're signed in, but you don't have wiki access. Ask in the{' '}
              <Link href={socials.discord} target="_blank" rel="noopener noreferrer">
                Discord
              </Link>
              .
            </Typography>
          )}
          {signOutButton}
          {session.me.editor && session.me.firstSignIn && <FirstSignInDialog me={session.me} />}
        </>
      )}
      {session.status === 'check-failed' && (
        <>
          <Who me={session.me} />
          <Alert
            severity="warning"
            data-wiki-check-failed
            sx={{ py: 0 }}
            action={
              <Button color="inherit" size="small" onClick={() => void loadWikiSession(true)}>
                Try again
              </Button>
            }
          >
            Couldn't check your wiki access with Discord.
          </Alert>
          {signOutButton}
        </>
      )}
      {signOutFailed && (
        <Typography variant="body2" color="error">
          Signing out didn't work. Try again.
        </Typography>
      )}
    </Box>
  );
}
