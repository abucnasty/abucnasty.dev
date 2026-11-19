import { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';

// A ```mermaid code block drawn as a diagram, after the markdown has rendered. Until it is drawn
// (and if it can't be) the source shows as the code block it is; mermaid itself (src/mermaid.ts)
// is downloaded only when a page has a diagram.

type State = 'loading' | 'drawn' | 'failed';

// A diagram wider than the column shrinks to fit, but to no less than this share of its own width
// (so its text stays readable); past that it scrolls sideways inside its box.
const MIN_SCALE = 0.7;

export function MermaidDiagram({ source }: { source: string }) {
  const [state, setState] = useState<State>('loading');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setState('loading');
    import('../mermaid')
      .then((m) => m.renderMermaid(source))
      .then(
        (svg) => {
          if (!live || !box.current) return;
          // mermaid sets max-width to the diagram's natural width and width to 100%.
          const natural = parseFloat(svg.style.maxWidth) || svg.viewBox.baseVal?.width || 0;
          if (natural > 0) svg.style.minWidth = `${Math.round(natural * MIN_SCALE)}px`;
          svg.style.height = 'auto';
          box.current.replaceChildren(svg);
          setState('drawn');
        },
        () => live && setState('failed'),
      );
    return () => {
      live = false;
    };
  }, [source]);

  return (
    <Box className="mermaid-diagram" data-mermaid={state} sx={{ my: 2 }}>
      {state !== 'drawn' && (
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
      )}
      {state === 'failed' && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: -1 }}>
          Couldn't draw this diagram.
        </Typography>
      )}
      <Box
        ref={box}
        sx={{
          display: state === 'drawn' ? 'block' : 'none',
          overflowX: 'auto',
          backgroundColor: 'background.paper',
          p: 2,
          '& svg': { display: 'block', mx: 'auto' },
        }}
      />
    </Box>
  );
}
