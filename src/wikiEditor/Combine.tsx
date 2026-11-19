// Combining two edits made at the same time (worker/wikiMerge.ts answered a conflict): the page as
// it is now (someone else's edit) and the editor's own text, side by side (@codemirror/merge), on a
// phone in one column with their lines above the editor's. The editor's side starts with the
// other edit's changes that did not overlap already in, so only what both changed (and the
// editor's own changes) is marked. Each marked part can be taken from their version ("Use theirs"),
// and the editor's side can be edited freely; "Save combined version" saves it against the page as
// it is now. Cancel goes back to the editor's own text in the editor. Its own chunk, loaded the
// first time a conflict is shown.
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { Conflict } from './api';
import { otherEditors } from './concurrent';

const COLLAPSE = { margin: 3, minSize: 8 };

function controlButton(label: string, title: string, kind: string): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.className = 'wiki-combine-control';
  b.dataset.wikiCombineControl = kind;
  return b;
}

export interface CombineProps {
  conflict: Conflict;
  busy: boolean;
  error: string | null;
  onSave: (text: string) => void;
  onCancel: () => void;
}

export function Combine({ conflict, busy, error, onSave, onCancel }: CombineProps) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const stacked = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  /** The editor's side as it stands (kept across a switch between the two layouts). */
  const text = useRef(conflict.mine.combined);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const parent = host.current!;
    const theirs = conflict.theirs.body;
    const look: Extension = [
      EditorView.lineWrapping,
      EditorView.theme(
        {
          '&': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary, fontSize: '13px' },
          '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
          '.cm-collapsedLines': { backgroundColor: theme.palette.background.default, color: theme.palette.text.secondary },
          '.wiki-combine-control': {
            font: 'inherit',
            fontSize: '11px',
            cursor: 'pointer',
            color: theme.palette.primary.contrastText,
            backgroundColor: theme.palette.primary.main,
            border: 'none',
            borderRadius: '3px',
            padding: '1px 6px',
            margin: '0 2px',
          },
          '.wiki-combine-control[data-wiki-combine-control="accept"]': { backgroundColor: theme.palette.grey[700], color: theme.palette.common.white },
        },
        { dark: theme.palette.mode === 'dark' },
      ),
    ];
    const mine: Extension = [
      look,
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        text.current = u.state.doc.toString();
        setChanged(true);
      }),
      EditorView.contentAttributes.of({ 'aria-label': 'Your version (editable)', 'data-wiki-combine-mine': '' }),
    ];
    if (stacked) {
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: text.current,
          extensions: [
            mine,
            unifiedMergeView({
              original: theirs,
              collapseUnchanged: COLLAPSE,
              mergeControls: (type, action) => {
                const b = type === 'accept' ? controlButton('Keep mine', 'Keep your version of this part', 'accept') : controlButton('Use theirs', 'Use their version of this part', 'reject');
                b.onmousedown = action;
                return b;
              },
            }),
          ],
        }),
      });
      return () => view.destroy();
    }
    const view = new MergeView({
      parent,
      a: { doc: theirs, extensions: [look, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.contentAttributes.of({ 'aria-label': 'Their version', 'data-wiki-combine-theirs': '' })] },
      b: { doc: text.current, extensions: mine },
      revertControls: 'a-to-b',
      // The gap between the two sides is narrow: an arrow, named by its title.
      renderRevertControl: () => controlButton('→', 'Use their version of this part', 'reject'),
      collapseUnchanged: COLLAPSE,
      gutter: true,
    });
    return () => view.destroy();
  }, [conflict, stacked, theme]);

  const now = Date.now();
  const who = otherEditors(conflict.theirs.edits, now);
  const label = (s: string) => (
    <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
      {s}
    </Typography>
  );
  return (
    <Stack spacing={1.5} data-wiki-combine={stacked ? 'stacked' : 'side-by-side'}>
      <Alert severity="warning" data-wiki-combine-notice>
        {who} changed the same part of this page while you were editing. Their other changes are already in your version. For each marked part, keep yours or use theirs ({stacked ? '"Use theirs"' : '→'}), edit your version as you like, then save the combined version.
      </Alert>
      {stacked ? (
        label('Their lines (red) above yours (green); edit yours')
      ) : (
        <Box sx={{ display: 'flex' }}>
          <Box sx={{ flex: 1 }}>{label('Their version (the page now)')}</Box>
          <Box sx={{ flex: 1, pl: 3 }}>{label('Your version (editable)')}</Box>
        </Box>
      )}
      <Box
        ref={host}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', maxWidth: '100%', '& .cm-mergeView, & > .cm-editor': { maxHeight: '70vh', overflowY: 'auto' },
          // The control between the two sides sits outside both editors (their theme doesn't reach it).
          '& .cm-merge-revert .wiki-combine-control': { font: 'inherit', fontSize: '14px', lineHeight: 1.2, cursor: 'pointer', color: 'primary.contrastText', bgcolor: 'primary.main', border: 'none', borderRadius: '3px', px: 0.5, my: 0.25 },
        }}
      />
      {error && (
        <Alert severity="error" data-wiki-combine-error>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button onClick={onCancel} disabled={busy} data-wiki-combine-cancel>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => onSave(text.current)} disabled={busy} data-wiki-combine-save data-wiki-combine-changed={changed ? 'true' : 'false'}>
          {busy ? 'Saving…' : 'Save combined version'}
        </Button>
      </Stack>
    </Stack>
  );
}

export default Combine;
