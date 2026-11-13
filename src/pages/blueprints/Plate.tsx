import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Box, ButtonBase, Modal } from '@mui/material';
import { PLATE_CHROME, colors, focusRing, titleFont } from './tokens';

/** How tall the plate may be: across the stage, beside the details, or on a phone. */
export type PlateFit = 'stacked' | 'side' | 'phone';

const MAX_HEIGHT: Record<PlateFit, string> = {
  stacked: '62vh',
  side: `calc(100vh - ${PLATE_CHROME}px)`,
  phone: '70vh',
};

/** Width of a plate showing a `w`×`h` image: no wider than its slot, the height limit allows, or its natural size. */
export function plateWidth(w: number, h: number, fit: PlateFit): string {
  return `min(100%, ${w}px, calc(${MAX_HEIGHT[fit]} * ${w / h}))`;
}

interface PlateProps {
  src: string;
  alt: string;
  /** Natural size, when known (from the index, or measured on load). */
  width?: number;
  height?: number;
  fit: PlateFit;
  onMeasured: (src: string, width: number, height: number) => void;
}

export function Plate({ src, alt, width, height, fit, onMeasured }: PlateProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const known = Boolean(width && height);

  if (failedSrc === src) {
    return (
      <Box
        data-plate="failed"
        sx={{
          width: known ? plateWidth(width!, height!, fit) : '100%',
          aspectRatio: known ? `${width} / ${height}` : '16 / 9',
          maxHeight: 320,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${colors.rule}`,
          color: colors.secondary,
          fontSize: 14,
        }}
      >
        The render didn't load.
      </Box>
    );
  }

  return (
    <>
      <ButtonBase
        data-plate="image"
        aria-label={`Open the render of ${alt.replace(/^Render of /, '')} full screen`}
        onClick={() => setViewerOpen(true)}
        disableRipple
        sx={{
          display: 'block',
          p: 0,
          backgroundColor: colors.void,
          cursor: 'zoom-in',
          ...(known
            ? { width: plateWidth(width!, height!, fit), aspectRatio: `${width} / ${height}` }
            : { width: 'fit-content', maxWidth: '100%' }),
          ...focusRing,
        }}
      >
        <Box
          component="img"
          key={src}
          src={src}
          alt={alt}
          decoding="async"
          onLoad={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (!known && img.naturalWidth && img.naturalHeight) onMeasured(src, img.naturalWidth, img.naturalHeight);
          }}
          onError={() => setFailedSrc(src)}
          sx={
            known
              ? { display: 'block', width: '100%', height: '100%' }
              : { display: 'block', maxWidth: '100%', maxHeight: MAX_HEIGHT[fit], width: 'auto', height: 'auto' }
          }
        />
      </ButtonBase>
      {viewerOpen && <Viewer src={src} alt={alt} onClose={() => setViewerOpen(false)} />}
    </>
  );
}

/** The plate of a blueprint with no render yet: a blue ghost grid, like a planned build in the game. */
export function GhostPlate({ text = 'Not rendered yet' }: { text?: string }) {
  return (
    <Box
      data-plate="ghost"
      sx={{
        width: '100%',
        maxWidth: 576,
        maxHeight: 320,
        aspectRatio: '16 / 9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(74,158,234,0.45)',
        backgroundColor: colors.void,
        backgroundImage:
          'linear-gradient(rgba(74,158,234,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(74,158,234,0.18) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      }}
    >
      <Box
        component="p"
        sx={{ m: 0, px: '14px', py: '6px', backgroundColor: colors.void, fontFamily: titleFont, fontSize: 16, fontWeight: 600, color: colors.ghostText }}
      >
        {text}
      </Box>
    </Box>
  );
}

const viewerButton = {
  height: 44,
  px: 2,
  backgroundColor: 'rgba(18,18,18,0.92)',
  color: colors.text,
  fontFamily: titleFont,
  fontSize: 15,
  fontWeight: 600,
  '&:hover': { backgroundColor: colors.panelRaised },
  ...focusRing,
  '&:focus-visible': { outline: `2px solid ${colors.amber}`, outlineOffset: '-2px' },
} as const;

/** The render full screen: fitted at first, "Actual size" scrolls and pans by dragging. */
function Viewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [actual, setActual] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!actual || e.button !== 0 || !scroller.current) return;
    drag.current = { x: e.clientX, y: e.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop, id: e.pointerId };
    scroller.current.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !scroller.current || d.id !== e.pointerId) return;
    scroller.current.scrollLeft = d.left - (e.clientX - d.x);
    scroller.current.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <Modal open onClose={onClose} hideBackdrop aria-label={alt}>
      <Box sx={{ position: 'fixed', inset: 0, backgroundColor: colors.void, outline: 'none' }} data-viewer>
        <Box
          ref={scroller}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          sx={{
            position: 'absolute',
            inset: 0,
            overflow: actual ? 'auto' : 'hidden',
            display: 'flex',
            cursor: actual ? (dragging ? 'grabbing' : 'grab') : 'default',
            touchAction: actual ? 'none' : 'auto',
            userSelect: 'none',
          }}
        >
          <Box
            component="img"
            src={src}
            alt={alt}
            draggable={false}
            sx={
              actual
                ? { display: 'block', flex: '0 0 auto', maxWidth: 'none', m: 'auto' }
                : { display: 'block', m: 'auto', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
            }
          />
        </Box>
        <Box sx={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 1 }}>
          <ButtonBase onClick={() => setActual((v) => !v)} sx={viewerButton}>
            {actual ? 'Fit' : 'Actual size'}
          </ButtonBase>
          <ButtonBase onClick={onClose} sx={viewerButton} autoFocus>
            Close
          </ButtonBase>
        </Box>
      </Box>
    </Modal>
  );
}
