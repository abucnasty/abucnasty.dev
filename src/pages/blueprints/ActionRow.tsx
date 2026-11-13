import { useLayoutEffect, useRef, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { copyFromUrl, copyText, useCopy } from './copy';
import { colors, focusRing, monoFont, titleFont } from './tokens';

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

let canvas: HTMLCanvasElement | null = null;
function measure(text: string, font: string): number {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * The address shortened in the middle to fit `width`: whole path segments go first
 * ("host/…/book/0/0.txt"), then the start of the last one ("host/…/the-iron-maden-20k…txt").
 */
function middleEllipsis(full: string, width: number, font: string): string {
  if (width <= 0 || measure(full, font) <= width) return full;
  const [host, ...segments] = full.split('/');
  for (let k = segments.length - 1; k >= 1; k -= 1) {
    const candidate = `${host}/…/${segments.slice(-k).join('/')}`;
    if (measure(candidate, font) <= width) return candidate;
  }
  const last = segments[segments.length - 1] ?? '';
  const dot = last.lastIndexOf('.');
  const ext = dot > 0 ? last.slice(dot + 1) : '';
  const stem = dot > 0 ? last.slice(0, dot) : last;
  for (let n = stem.length - 1; n >= 1; n -= 1) {
    const candidate = `${host}/…/${stem.slice(0, n)}…${ext}`;
    if (measure(candidate, font) <= width) return candidate;
  }
  return `${host}/…`;
}

function useFittedAddress(full: string) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const [shown, setShown] = useState(full);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const style = getComputedStyle(el);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      setShown(middleEllipsis(full, el.clientWidth - 2, font));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // The web font may arrive after the first measurement.
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [full]);
  return { ref, shown };
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="11" height="11" />
      <path d="M5 15V4h11" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

interface ActionRowProps {
  /** The string's live address. */
  url: string;
  /** "row": the button beside the link bar (stacked screens); "column": the bar under it. */
  layout: 'row' | 'column';
  phone: boolean;
}

export function ActionRow({ url, layout, phone }: ActionRowProps) {
  const [copyState, runCopy] = useCopy(url);
  const [linkState, runLinkCopy] = useCopy(url);
  const address = url.replace(/^https?:\/\//, '');
  const { ref, shown } = useFittedAddress(address);
  const column = layout === 'column' || phone;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: column ? 'nowrap' : 'wrap',
          flexDirection: column ? 'column' : 'row',
          gap: phone ? '8px' : '12px',
        }}
      >
        <ButtonBase
          onClick={() => runCopy(() => copyFromUrl(url))}
          aria-busy={copyState === 'busy'}
          sx={{
            flex: '0 0 auto',
            alignSelf: column && !phone ? 'flex-start' : undefined,
            height: phone ? 48 : 44,
            px: phone ? 0 : '28px',
            backgroundColor: colors.amber,
            color: '#000',
            fontFamily: titleFont,
            fontSize: phone ? 17 : 16,
            fontWeight: 700,
            '&:hover': { backgroundColor: colors.amberLight },
            ...focusRing,
          }}
        >
          {copyState === 'copied' ? 'Copied' : 'Copy string'}
        </ButtonBase>
        <Box
          sx={{
            flex: column ? '0 0 auto' : '1 1 320px',
            minWidth: 0,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            pl: phone ? '12px' : '14px',
            backgroundColor: colors.panel,
          }}
        >
          <Box
            component="a"
            ref={ref}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={address}
            aria-label={address}
            sx={{
              flex: '1 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              fontFamily: monoFont,
              fontSize: phone ? 12 : 13,
              color: colors.soft,
              textDecoration: 'none',
              '&:hover': { color: colors.amberLight, textDecoration: 'underline' },
              ...focusRing,
              '&:focus-visible': { outline: `2px solid ${colors.amber}`, outlineOffset: '-2px' },
            }}
          >
            {shown}
          </Box>
          <ButtonBase
            aria-label={linkState === 'copied' ? 'Link copied' : 'Copy link'}
            onClick={() => runLinkCopy(() => copyText(url))}
            sx={{
              flex: '0 0 auto',
              width: 44,
              height: 44,
              color: linkState === 'copied' ? colors.text : colors.secondary,
              '&:hover': { color: colors.text },
              ...focusRing,
              '&:focus-visible': { outline: `2px solid ${colors.amber}`, outlineOffset: '-2px' },
            }}
          >
            {linkState === 'copied' ? <CheckIcon /> : <CopyIcon />}
          </ButtonBase>
        </Box>
      </Box>
      <Box component="span" role="status" sx={visuallyHidden}>
        {copyState === 'copied' ? 'String copied' : linkState === 'copied' ? 'Link copied' : ''}
      </Box>
      {(copyState === 'failed' || linkState === 'failed') && (
        <Box role="alert" sx={{ fontSize: 14, color: colors.soft }}>
          Couldn't copy. Open the link and copy it from there.
        </Box>
      )}
    </Box>
  );
}
