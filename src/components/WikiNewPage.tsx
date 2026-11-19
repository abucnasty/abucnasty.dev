// "New page", for wiki editors: a title (the vault's rules: unique ignoring case, a free address,
// no characters that break file names or links) and a folder: one that holds wiki pages, or a new
// one typed in (nested with "/"; git has no empty folders, so saving the page makes it). Empty is
// the top level. A typed folder that matches one ignoring case takes its spelling. Creating opens
// the editor on the new page's address; nothing is saved until the editor saves it.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField } from '@mui/material';
import { wikiRoute, wikiSlug, type WikiIndex } from '../wikiCore';
import { existingFolder, MAX_FOLDER, pageFolderProblem, tidyFolder, titleClash, titleProblem } from '../wikiSource';

export function NewPageDialog({ index, initialTitle, onClose }: { index: WikiIndex; initialTitle: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(initialTitle);
  const [folderInput, setFolderInput] = useState('');
  /** Every folder with pages, and the folders above them. */
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
  const folderNote = folder === '' ? 'Empty: the top level.' : folders.includes(folder) ? `In ${folder.split('/').join(' / ')}` : `A new folder: ${folder.split('/').join(' / ')}`;
  const taken = useMemo(() => index.pages.flatMap((p) => [p.title, ...p.aliases]), [index]);
  const t = title.trim();
  const problem = t === '' ? null : titleProblem(t) ?? (titleClash(t, taken) ? `There's already a page called "${titleClash(t, taken)}" (or one with the same address).` : null);
  const create = () => {
    if (t === '' || problem || folderIssue) return;
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
          <Autocomplete
            freeSolo
            options={folders}
            inputValue={folderInput}
            onInputChange={(_, v) => setFolderInput(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Folder"
                placeholder="Top level, or pick or type one (Guides/Linux)"
                error={!!folderIssue}
                helperText={folderIssue ?? folderNote}
                inputProps={{ ...params.inputProps, 'data-wiki-new-folder': '', maxLength: MAX_FOLDER }}
              />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={create} disabled={t === '' || !!problem || !!folderIssue} data-wiki-new-create>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default NewPageDialog;
