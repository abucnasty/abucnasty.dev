// "New page", for wiki editors: a title (the vault's rules: unique ignoring case, a free address,
// no characters that break file names or links) and a folder that already holds wiki pages (the
// top level by default). Creating opens the editor on the new page's address; nothing is saved
// until the editor saves it.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { wikiFolders, wikiRoute, wikiSlug, type WikiIndex } from '../wikiCore';
import { titleClash, titleProblem } from '../wikiSource';

export function NewPageDialog({ index, initialTitle, onClose }: { index: WikiIndex; initialTitle: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(initialTitle);
  const [folder, setFolder] = useState('');
  const folders = useMemo(() => wikiFolders(index).map((g) => g.folder), [index]);
  const taken = useMemo(() => index.pages.flatMap((p) => [p.title, ...p.aliases]), [index]);
  const t = title.trim();
  const problem = t === '' ? null : titleProblem(t) ?? (titleClash(t, taken) ? `There's already a page called "${titleClash(t, taken)}" (or one with the same address).` : null);
  const create = () => {
    if (t === '' || problem) return;
    navigate(wikiRoute(wikiSlug(t)), { state: { create: { title: t, folder } } });
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" data-wiki-new-page>
      <DialogTitle>New page</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>The title is the page's name and address. It can be changed later in the vault.</DialogContentText>
        <Stack spacing={2}>
          <TextField
            autoFocus
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            error={!!problem}
            helperText={problem ?? (t ? `abucnasty.dev${wikiRoute(wikiSlug(t))}` : ' ')}
            slotProps={{ htmlInput: { 'data-wiki-new-title': '', maxLength: 100 } }}
          />
          <TextField select label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
            {['', ...folders.filter((f) => f !== '')].map((f) => (
              <MenuItem key={f} value={f}>
                {f === '' ? 'Top level' : f.split('/').join(' / ')}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={create} disabled={t === '' || !!problem} data-wiki-new-create>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default NewPageDialog;
