import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { parseHeadings } from '../tableOfContents';

interface TableOfContentsProps {
  markdown: string;
  /** Tallest the list gets before it scrolls: px or any CSS length. Default 360. */
  maxHeight?: number | string;
  /** The markdown is a wiki page's: `[[Page|label]]` in a heading is read as its label. */
  wikiLinks?: boolean;
}

export function TableOfContents({ markdown, maxHeight = 360, wikiLinks = false }: TableOfContentsProps) {
  const headings = useMemo(() => parseHeadings(markdown, { wikiLinks }), [markdown, wikiLinks]);
  const [activeId, setActiveId] = useState<string>('');
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!activeId || !navRef.current) return;
    const activeEl = navRef.current.querySelector<HTMLElement>(`[data-toc-id="${activeId}"]`);
    if (!activeEl) return;
    const nav = navRef.current;
    const elTop = activeEl.offsetTop;
    const elBottom = elTop + activeEl.offsetHeight;
    const navTop = nav.scrollTop;
    const navBottom = navTop + nav.clientHeight;
    if (elTop < navTop || elBottom > navBottom) {
      nav.scrollTo({ top: elTop - nav.clientHeight / 2, behavior: 'smooth' });
    }
  }, [activeId]);

  useEffect(() => {
    if (headings.length === 0) return;

    const headingEls = headings
      .map(({ id }) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    const onScroll = () => {
      // Find the last heading whose top edge is at or above the middle of the viewport
      const mid = window.scrollY + window.innerHeight * 0.3;
      let active = headingEls[0];
      for (const el of headingEls) {
        if (el.offsetTop <= mid) active = el;
        else break;
      }
      if (active) setActiveId(active.id);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // set initial state

    return () => window.removeEventListener('scroll', onScroll);
  }, [headings]);

  if (headings.length === 0) return null;

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <Box>
      <Typography
        variant="overline"
        sx={{ color: 'primary.main', letterSpacing: 2, display: 'block', mb: 1, fontSize: '0.7rem' }}
      >
        On this page
      </Typography>
      <Box
        component="nav"
        ref={navRef}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
          maxHeight,
          overflowY: 'auto',
        }}
      >
        {headings.map(({ id, text, level }) => (
          <Link
            key={id}
            href={`#${id}`}
            data-toc-id={id}
            underline="none"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            sx={{
              pl: (level - minLevel) * 1.5,
              py: 0.4,
              pr: 1,
              fontSize: '0.78rem',
              lineHeight: 1.4,
              color: activeId === id ? 'primary.main' : 'text.secondary',
              fontWeight: activeId === id ? 600 : 400,
              borderLeft: '2px solid',
              borderColor: activeId === id ? 'primary.main' : 'transparent',
              transition: 'color 0.15s, border-color 0.15s',
              cursor: 'pointer',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {text}
          </Link>
        ))}
      </Box>
    </Box>
  );
}
