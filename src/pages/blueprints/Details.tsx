import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, ButtonBase } from '@mui/material';
import YouTubeIcon from '@mui/icons-material/YouTube';
import { Link as RouterLink } from 'react-router-dom';
import { blueprintRoute, versionUrl, type CatalogEntry } from '../../catalog';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';
import { layout } from '../../layout';
import { copyFromUrl, useCopy } from './copy';
import { blueprintsFact, datePart, flattenNodes, isBook, nodeLabel } from './model';
import { colors, focusRing, titleFont } from './tokens';

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Box component="h3" sx={{ m: 0, fontFamily: titleFont, fontSize: 18, fontWeight: 600, lineHeight: 1.5 }}>
      {children}
    </Box>
  );
}

export const textLink = {
  color: colors.text,
  '&:hover': { color: colors.amberLight },
  ...focusRing,
} as const;

/** The facts as a definition list, then the video link. */
export function Facts({ entry }: { entry: CatalogEntry }) {
  const { counts, factorioVersion } = entry.blueprint;
  const rows: Array<[string, ReactNode]> = [];
  if (isBook(entry) || entry.blueprint.kind === 'blueprint-book') rows.push(['Blueprints', blueprintsFact(counts)]);
  rows.push(['Entities', counts.entities.toLocaleString('en-US')]);
  if (counts.tiles > 0) rows.push(['Tiles', counts.tiles.toLocaleString('en-US')]);
  if (factorioVersion) rows.push(['Factorio', factorioVersion]);
  if (entry.posted) rows.push(['Posted', entry.posted]);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Box component="dl" data-facts sx={{ m: 0, display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '8px 16px' }}>
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: 'contents' }}>
            <Box component="dt" sx={{ color: colors.secondary }}>
              {label}
            </Box>
            <Box component="dd" sx={{ m: 0, fontFamily: titleFont, fontSize: 16, fontWeight: 600 }}>
              {value}
            </Box>
          </Box>
        ))}
      </Box>
      {entry.video && (
        <Box
          component="a"
          href={entry.video}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ ...textLink, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 1, height: 44 }}
        >
          <YouTubeIcon aria-hidden sx={{ fontSize: 20 }} />
          Watch the video
        </Box>
      )}
    </Box>
  );
}

/** Where the contents list sits: beside the plate, under it, or on a phone. */
export type ContentsFit = 'side' | 'stacked' | 'phone';

/** The list's height limit on a wide screen, and the least the side-by-side list may get. */
const CONTENTS_CAP = 420;
/** Space kept under the side-by-side list: the stage's bottom padding. */
const CONTENTS_BOTTOM_GAP = 32;

/**
 * The book's tree; each row selects that entry. "Whole book" first. Beside the plate the list may
 * run down to near the bottom of the window (never under 420 px); under the plate it stops at
 * 420 px; on a phone it never scrolls on its own. It scrolls, with rules above and below, only
 * when it overflows.
 */
export function Contents({ entry, selected, fit }: { entry: CatalogEntry; selected: string | null; fit: ContentsFit }) {
  const rows = flattenNodes(entry.nodes);
  const box = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(fit === 'phone' ? null : CONTENTS_CAP);
  const [overflowing, setOverflowing] = useState(false);

  // The limit: what is left of the window below the list's top, measured from the top of the page.
  useLayoutEffect(() => {
    if (fit !== 'side') {
      setMaxHeight(fit === 'stacked' ? CONTENTS_CAP : null);
      return;
    }
    const measure = () => {
      const el = box.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setMaxHeight(Math.max(CONTENTS_CAP, Math.floor(window.innerHeight - top - CONTENTS_BOTTOM_GAP)));
    };
    measure();
    // The header above can still change height: the web font arriving, a breadcrumb for an entry.
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [fit, selected]);

  // Whether the rows overflow that limit.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || maxHeight === null) {
      setOverflowing(false);
      return;
    }
    const check = () => setOverflowing(el.scrollHeight > maxHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight, rows.length]);

  // Bring the selected row into the list's own scroll box (never the page).
  useEffect(() => {
    const el = box.current;
    if (!el || !overflowing) return;
    const row = el.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row) return;
    const top = row.offsetTop; // the box is the rows' offset parent
    if (top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = top - el.clientHeight / 2 + row.offsetHeight / 2;
    }
  }, [selected, overflowing, maxHeight]);

  const phone = fit === 'phone';
  const row = (key: string, label: string, to: string, depth: number, strong: boolean, on: boolean) => (
    <Box
      key={key}
      component={RouterLink}
      to={to}
      replace
      aria-current={on ? 'true' : undefined}
      sx={{
        minHeight: phone ? layout.touchTarget : 32,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        py: '4px',
        pr: '12px',
        pl: `${12 + 16 * depth}px`,
        textDecoration: 'none',
        fontFamily: titleFont,
        fontSize: 15,
        lineHeight: 1.3,
        borderLeft: `3px solid ${on ? colors.amber : 'transparent'}`,
        backgroundColor: on ? colors.panelRaised : 'transparent',
        color: on || strong ? colors.text : colors.soft,
        fontWeight: on || strong ? 600 : 400,
        '&:hover': { backgroundColor: colors.panelRaised, color: colors.text },
        ...focusRing,
        '&:focus-visible': { outline: `2px solid ${colors.amber}`, outlineOffset: '-2px' },
      }}
    >
      {label}
    </Box>
  );

  const base = blueprintRoute(entry.path);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <SectionTitle>In this book</SectionTitle>
      <Box
        ref={box}
        data-contents
        data-overflowing={overflowing ? 'true' : undefined}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          ...(maxHeight !== null ? { maxHeight } : {}),
          ...(overflowing
            ? { overflowY: 'auto', overscrollBehavior: 'contain', borderTop: `1px solid ${colors.rule}`, borderBottom: `1px solid ${colors.rule}` }
            : { overflowY: 'visible' }),
        }}
      >
        {row('whole', 'Whole book', base, 0, true, selected === null)}
        {rows.map(({ node, depth }) =>
          row(node.path, nodeLabel(node), `${base}?entry=${node.path}`, depth, node.kind === 'blueprint-book', selected === node.path),
        )}
      </Box>
    </Box>
  );
}

/** The owner's notes. Renders nothing for an empty note. */
export function Notes({ text, heading = 'Notes' }: { text: string; heading?: string | null }) {
  if (!text) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {heading && <SectionTitle>{heading}</SectionTitle>}
      <NotesBody text={text} />
    </Box>
  );
}

export function NotesBody({ text }: { text: string }) {
  return (
    <MarkdownRenderer
      source={text}
      sx={{
        color: colors.soft,
        fontSize: 15,
        lineHeight: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        maxWidth: 560,
        '& p, & ul, & ol': { m: 0, fontSize: 15, lineHeight: 1.5, color: colors.soft },
        '& ul, & ol': { pl: 2.5 },
        '& h1, & h2, & h3, & h4': { m: 0, mt: 1, fontSize: 16, fontWeight: 600, border: 0, p: 0 },
        '& a': { color: colors.text },
        '& a:hover': { color: colors.amberLight },
        '& img': { my: 1 },
      }}
    />
  );
}

function VersionRow({ path, sha, date, subject, current }: { path: string; sha: string; date: string; subject: string; current: boolean }) {
  const [state, run] = useCopy(sha);
  const day = datePart(date);
  return (
    <Box sx={{ minHeight: 44, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, borderBottom: `1px solid ${colors.rule}` }}>
      <Box component="span" sx={{ flex: '0 0 96px', fontFamily: titleFont, fontSize: 15, color: colors.secondary }}>
        {day}
      </Box>
      <Box component="span" sx={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere', py: '10px' }}>
        {subject}
      </Box>
      {current ? (
        <Box component="span" sx={{ flex: '0 0 72px', textAlign: 'right', fontSize: 14, color: colors.green }}>
          current
        </Box>
      ) : (
        <ButtonBase
          aria-label={state === 'copied' ? `Copied the ${day} version` : `Copy the string of the ${day} version`}
          onClick={() => run(() => copyFromUrl(versionUrl(path, sha)))}
          sx={{
            flex: '0 0 72px',
            height: 44,
            justifyContent: 'flex-end',
            color: colors.text,
            fontFamily: titleFont,
            fontSize: 15,
            fontWeight: 600,
            textDecoration: 'underline',
            '&:hover': { color: colors.amberLight },
            ...focusRing,
          }}
        >
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Failed' : 'Copy'}
        </ButtonBase>
      )}
    </Box>
  );
}

/** Older strings, newest first; only when there is more than one. */
export function Versions({ entry }: { entry: CatalogEntry }) {
  if (entry.history.length < 2) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-versions>
      <SectionTitle>Versions</SectionTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {entry.history.map((h, i) => (
          <VersionRow key={h.sha} path={entry.path} sha={h.sha} date={h.date} subject={h.subject} current={i === 0} />
        ))}
      </Box>
    </Box>
  );
}
