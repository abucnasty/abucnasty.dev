import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Link, Typography } from '@mui/material';

interface Heading {
  id: string;
  text: string;
  level: number;
}

// Mirrors rehype-slug's github-slugger algorithm: each space becomes a hyphen on its own,
// so "Cars / Tanks" gives "cars--tanks", as the rendered heading id does.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/ /g, '-');
}

function parseHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  const seen: Record<string, number> = {};
  let inCodeBlock = false;
  for (const line of markdown.split('\n')) {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (!m) continue;
    const level = m[1].length;
    // Links render as their label; the id is built from that, keeping "_" as rehype-slug does
    const linked = m[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    // Strip inline markdown from display text
    const text = linked.replace(/[*_`]/g, '').trim();
    const base = slugify(linked);
    const count = seen[base] ?? 0;
    seen[base] = count + 1;
    const id = count === 0 ? base : `${base}-${count}`;
    headings.push({ id, text, level });
  }
  return headings;
}

interface TableOfContentsProps {
  markdown: string;
  /** Tallest the list gets before it scrolls: px or any CSS length. Default 360. */
  maxHeight?: number | string;
}

export function TableOfContents({ markdown, maxHeight = 360 }: TableOfContentsProps) {
  const headings = useMemo(() => parseHeadings(markdown), [markdown]);
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
