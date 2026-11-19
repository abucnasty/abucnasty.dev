// What an edit changed, for wiki editors on a page's history: the version before and after side by
// side (@codemirror/merge), or on a phone in one column with removed lines above added ones.
// Unchanged stretches are folded. Read-only. Its own chunk, loaded when an editor opens a diff.
import { useEffect, useRef } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const COLLAPSE = { margin: 3, minSize: 6 };

export function WikiDiff({ before, after }: { before: string; after: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const stacked = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });

  useEffect(() => {
    const parent = host.current!;
    const base: Extension[] = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.theme(
        {
          '&': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary, fontSize: '13px' },
          '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
          '.cm-collapsedLines': { backgroundColor: theme.palette.background.default, color: theme.palette.text.secondary },
        },
        { dark: theme.palette.mode === 'dark' },
      ),
    ];
    if (stacked) {
      const view = new EditorView({
        parent,
        state: EditorState.create({ doc: after, extensions: [...base, unifiedMergeView({ original: before, mergeControls: false, collapseUnchanged: COLLAPSE })] }),
      });
      return () => view.destroy();
    }
    const view = new MergeView({ parent, a: { doc: before, extensions: base }, b: { doc: after, extensions: base }, collapseUnchanged: COLLAPSE, gutter: true });
    return () => view.destroy();
  }, [before, after, stacked, theme]);

  return (
    <Box
      ref={host}
      data-wiki-diff={stacked ? 'stacked' : 'side-by-side'}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', maxWidth: '100%', '& .cm-mergeView': { maxHeight: '70vh', overflowY: 'auto' } }}
    />
  );
}

export default WikiDiff;
