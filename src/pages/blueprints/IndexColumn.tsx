import { useEffect, useMemo, useRef } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { VAULT_REPO_URL, blueprintRoute, isListed, type CatalogEntry, type CatalogState } from '../../catalog';
import { layout } from '../../layout';
import { buildIndex, filterEntries } from './model';
import { colors, focusRing, titleFont } from './tokens';

interface IndexColumnProps {
  state: CatalogState;
  /** Path of the entry the visitor picked; nothing is marked before that. */
  selectedPath: string | null;
  query: string;
  onQuery: (q: string) => void;
  showDeprecated: boolean;
  onShowDeprecated: (v: boolean) => void;
  phone: boolean;
}

function SearchGlyph() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

const PLACEHOLDER_WIDTHS = [62, 78, 54, 70, 66, 48, 74, 58, 80, 52, 68, 60];

export function IndexColumn({ state, selectedPath, query, onQuery, showDeprecated, onShowDeprecated, phone }: IndexColumnProps) {
  const all = state.catalog?.blueprints;
  // Unlisted builds open by their address but are left out of the index, the filter and the counts.
  const entries = useMemo(() => (all ?? []).filter(isListed), [all]);
  const deprecatedCount = entries.filter((e) => e.deprecated).length;
  const active = entries.length - deprecatedCount;
  const q = query.trim();

  const groups = useMemo(() => {
    // A deprecated build stays listed while it is the one on the stage.
    const visible = entries.filter((e) => showDeprecated || !e.deprecated || e.path === selectedPath);
    return buildIndex(filterEntries(visible, q));
  }, [entries, showDeprecated, selectedPath, q]);

  const list = useRef<HTMLDivElement | null>(null);
  // Bring the selected row into the index's own scroll box (desktop) without moving the page.
  useEffect(() => {
    const el = list.current;
    if (!el || phone || !selectedPath) return;
    const row = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row) return;
    const top = row.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = top - el.clientHeight / 3;
    }
  }, [selectedPath, phone, state.status]);

  const pad = phone ? 16 : 20;
  const rowHeight = phone ? layout.touchTarget : layout.rowHeight;

  const row = (e: CatalogEntry) => {
    const on = e.path === selectedPath;
    return (
      <Box
        key={e.path}
        component={RouterLink}
        to={blueprintRoute(e.path)}
        aria-current={on ? 'page' : undefined}
        data-index-row
        sx={{
          height: rowHeight,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          pl: `${(phone ? 28 : 32) - 3}px`,
          pr: `${pad}px`,
          textDecoration: 'none',
          fontFamily: titleFont,
          fontSize: phone ? 16 : 15,
          borderLeft: `3px solid ${on ? colors.amber : 'transparent'}`,
          backgroundColor: on ? colors.panelRaised : 'transparent',
          color: on ? colors.text : colors.soft,
          fontWeight: on ? 600 : 400,
          '&:hover': { backgroundColor: on ? colors.panelRaised : colors.rowHover, color: colors.text },
          ...focusRing,
          '&:focus-visible': { outline: `2px solid ${colors.amber}`, outlineOffset: '-2px' },
        }}
      >
        <Box component="span" sx={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: e.deprecated ? 0.62 : 1 }}>
          {e.title}
        </Box>
        {e.deprecated ? (
          <Box component="span" sx={{ flex: '0 0 auto', color: colors.secondary, fontSize: 14, fontWeight: 400 }}>
            deprecated
          </Box>
        ) : (
          e.version && (
            <Box component="span" sx={{ flex: '0 0 auto', color: colors.green, fontSize: 14, fontWeight: 400 }}>
              {e.version}
            </Box>
          )
        )}
      </Box>
    );
  };

  return (
    <Box
      component="nav"
      aria-label="Blueprint index"
      data-index
      sx={{
        backgroundColor: colors.panel,
        display: 'flex',
        flexDirection: 'column',
        ...(phone
          ? { width: '100%', minHeight: `calc(100vh - ${layout.topBarHeight}px)` }
          : {
              flex: '0 0 320px',
              width: 320,
              position: 'sticky',
              top: layout.topBarHeight,
              alignSelf: 'flex-start',
              height: `calc(100vh - ${layout.topBarHeight}px)`,
              borderRight: `1px solid ${colors.rule}`,
            }),
      }}
    >
      <Box sx={{ flex: '0 0 auto', p: phone ? '24px 16px 12px' : '28px 20px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <Box component="h1" sx={{ m: 0, fontFamily: titleFont, fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>
          Blueprints
        </Box>
        <Box component="p" data-count sx={{ m: 0, fontSize: 14, color: colors.secondary }}>
          {state.status === 'ready' ? (
            <>
              {active} {active === 1 ? 'build' : 'builds'}, straight from{' '}
              <Box component="a" href={VAULT_REPO_URL} sx={{ color: colors.soft, '&:hover': { color: colors.amberLight }, ...focusRing }}>
                the vault on GitHub
              </Box>
              .
            </>
          ) : state.status === 'loading' ? (
            'Loading the catalog.'
          ) : (
            "The catalog didn't load."
          )}
        </Box>
        <Box
          component="label"
          sx={{
            mt: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            height: phone ? 48 : 44,
            px: '12px',
            backgroundColor: colors.void,
            border: `1px solid ${colors.fieldBorder}`,
            color: colors.secondary,
            '&:focus-within': { outline: `2px solid ${colors.amber}`, outlineOffset: '-1px' },
          }}
        >
          <SearchGlyph />
          <Box
            component="input"
            type="search"
            aria-label="Find a build"
            placeholder="Find a build"
            value={query}
            disabled={state.status !== 'ready'}
            onChange={(e) => onQuery((e.target as HTMLInputElement).value)}
            sx={{
              flex: '1 1 auto',
              minWidth: 0,
              height: phone ? 44 : 40,
              border: 0,
              outline: 0,
              background: 'none',
              color: colors.text,
              fontFamily: titleFont,
              fontSize: phone ? 16 : 15,
              '&::placeholder': { color: colors.secondary, opacity: 1 },
            }}
          />
        </Box>
      </Box>

      <Box
        ref={list}
        data-index-list
        sx={phone ? { pb: 1 } : { flex: '1 1 0', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', pb: 1 }}
      >
        {state.status === 'loading' && (
          <Box aria-hidden data-index-placeholder sx={{ pt: '14px' }}>
            {PLACEHOLDER_WIDTHS.map((w, i) => (
              <Box key={i} sx={{ height: rowHeight, display: 'flex', alignItems: 'center', px: `${pad}px` }}>
                <Box sx={{ height: 12, width: `${w}%`, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              </Box>
            ))}
          </Box>
        )}
        {state.status === 'ready' && groups.length === 0 && q && (
          <Box role="status" sx={{ px: `${pad}px`, pt: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, fontSize: 14, color: colors.secondary }}>
            <span>Nothing matches “{q}”.</span>
            <ButtonBase
              onClick={() => onQuery('')}
              sx={{ height: 36, px: 1.5, border: `1px solid ${colors.fieldBorder}`, color: colors.text, fontFamily: titleFont, fontSize: 15, fontWeight: 600, '&:hover': { backgroundColor: colors.rowHover }, ...focusRing }}
            >
              Clear
            </ButtonBase>
          </Box>
        )}
        {groups.map((g) => (
          <Box key={g.key} role="group" aria-label={g.name}>
            <Box sx={{ p: `14px ${pad}px 2px`, fontFamily: titleFont, fontSize: 13, fontWeight: 700, color: colors.secondary }}>{g.name}</Box>
            {g.categories.map((c) => (
              <Box key={c.key}>
                {c.name && (
                  <Box
                    sx={{
                      height: phone ? 40 : layout.rowHeight,
                      display: 'flex',
                      alignItems: 'center',
                      px: `${pad}px`,
                      fontFamily: titleFont,
                      fontSize: phone ? 16 : 15,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.name}
                  </Box>
                )}
                {c.entries.map(row)}
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      {state.status === 'ready' && deprecatedCount > 0 && (
        <Box
          component="label"
          sx={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            height: 48,
            px: `${pad}px`,
            borderTop: `1px solid ${colors.rule}`,
            fontSize: 14,
            color: colors.secondary,
            cursor: 'pointer',
          }}
        >
          <Box
            component="input"
            type="checkbox"
            checked={showDeprecated}
            onChange={(e) => onShowDeprecated((e.target as HTMLInputElement).checked)}
            sx={{ width: 18, height: 18, m: 0, accentColor: colors.amber, cursor: 'pointer', ...focusRing }}
          />
          Show deprecated ({deprecatedCount})
        </Box>
      )}
    </Box>
  );
}
