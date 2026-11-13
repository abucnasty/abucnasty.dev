import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Box, Dialog, IconButton, InputBase } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { layout } from '../layout';
import { loadSaveTree, loadedSaveTree, type SaveTree } from '../saves';
import { useCatalog, type Catalog } from '../catalog';
import { SEARCH_GROUPS, blueprintEntries, saveEntries, search, staticEntries, type SearchEntry, type SearchKind } from '../search';

const GROUP_LIMIT = 6;

interface SearchContextValue {
  isOpen: boolean;
  open: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch must be used inside a SearchProvider');
  return ctx;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const { pathname, search: queryString } = useLocation();

  // A route change (a result opened, or back/forward) closes the dialog.
  useEffect(() => setOpen(false), [pathname, queryString]);

  const open = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ isOpen, open }), [isOpen, open]);

  return (
    <SearchContext.Provider value={value}>
      {children}
      <Dialog
        open={isOpen}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        sx={{ '& .MuiDialog-container': { alignItems: { xs: 'stretch', sm: 'flex-start' } } }}
        slotProps={{
          paper: {
            'aria-label': 'Search the site',
            sx: {
              backgroundColor: 'background.paper',
              backgroundImage: 'none',
              borderRadius: 0,
              m: { xs: 0, sm: '10vh 32px 0' },
              width: { xs: '100%', sm: 'calc(100% - 64px)' },
              maxWidth: { xs: 'none', sm: 600 },
              height: { xs: '100%', sm: 'auto' },
              maxHeight: { xs: 'none', sm: '80vh' },
            },
          },
        }}
      >
        <SearchBody onClose={() => setOpen(false)} />
      </Dialog>
    </SearchContext.Provider>
  );
}

let staticCache: SearchEntry[] | null = null;
const statics = () => (staticCache ??= staticEntries());
let blueprintCache: { catalog: Catalog; entries: SearchEntry[] } | null = null;
function blueprintsOf(catalog: Catalog | null): SearchEntry[] {
  if (!catalog) return [];
  if (blueprintCache?.catalog !== catalog) blueprintCache = { catalog, entries: blueprintEntries(catalog) };
  return blueprintCache.entries;
}

interface Row {
  id: string;
  entry: Pick<SearchEntry, 'title' | 'detail' | 'to' | 'external'>;
  /** The "All n ... matching" link at the end of a group. */
  all?: boolean;
  firstInGroup: boolean;
}

interface Group {
  kind: SearchKind;
  label: string;
  rows: Row[];
  /** Shown instead of rows while save files load, or when they could not. */
  message?: string;
}

const mutedLine = { px: 1.25, py: 1.5, fontSize: 14, color: 'text.secondary', overflowWrap: 'anywhere' } as const;

function SearchBody({ onClose }: { onClose: () => void }) {
  const uid = useId();
  const listId = `${uid}-results`;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [tree, setTree] = useState<SaveTree | null>(loadedSaveTree);
  const [failed, setFailed] = useState(false);
  // The blueprint catalog is fetched live (once per page load) as soon as the dialog opens.
  const catalogState = useCatalog();

  const q = query.trim();

  // The save index is its own chunk: it is requested the first time there is something to search for.
  useEffect(() => {
    if (!q || tree || failed) return;
    let cancelled = false;
    loadSaveTree().then(
      (t) => !cancelled && setTree(t),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [q, tree, failed]);

  const loadingSaves = Boolean(q) && !tree && !failed;

  const { groups, rows } = useMemo(() => {
    const flat: Row[] = [];
    const out: Group[] = [];
    if (!q) return { groups: out, rows: flat };
    const found = search([...statics(), ...blueprintsOf(catalogState.catalog)], q);
    const saves = tree ? search(saveEntries(tree, q), q) : [];
    const allLabel: Partial<Record<SearchKind, { to: string; noun: string }>> = {
      benchmark: { to: `/benchmarks?q=${encodeURIComponent(q)}`, noun: 'benchmarks' },
      save: { to: `/saves?q=${encodeURIComponent(q)}`, noun: 'save files' },
    };
    for (const { kind, label } of SEARCH_GROUPS) {
      const list = kind === 'save' ? saves : found.filter((e) => e.kind === kind);
      const message =
        kind === 'save'
          ? loadingSaves
            ? 'Searching save files…'
            : failed
              ? 'Save files could not be loaded.'
              : undefined
          : kind === 'blueprint' && list.length === 0
            ? catalogState.status === 'loading'
              ? 'Searching blueprints…'
              : catalogState.status === 'failed'
                ? 'Blueprints could not be loaded.'
                : undefined
            : undefined;
      if (list.length === 0 && !message) continue;
      const rowsOfGroup: Row[] = list.slice(0, GROUP_LIMIT).map((entry, i) => ({
        id: `${uid}-${kind}-${i}`,
        entry,
        firstInGroup: i === 0,
      }));
      const all = allLabel[kind];
      if (all && list.length > GROUP_LIMIT) {
        rowsOfGroup.push({
          id: `${uid}-${kind}-all`,
          entry: { title: `All ${list.length} ${all.noun} matching`, to: all.to },
          all: true,
          firstInGroup: false,
        });
      }
      flat.push(...rowsOfGroup);
      out.push({ kind, label, rows: rowsOfGroup, message });
    }
    return { groups: out, rows: flat };
  }, [q, tree, failed, loadingSaves, uid, catalogState.catalog, catalogState.status]);

  const activeRow: Row | undefined = rows[active];

  // Keep the active row (and its group heading, for a group's first row) inside the scrolling list.
  useEffect(() => {
    if (!activeRow) return;
    const el = document.getElementById(activeRow.id);
    if (!el) return;
    if (activeRow.firstInGroup) el.parentElement?.firstElementChild?.scrollIntoView({ block: 'nearest' });
    el.scrollIntoView({ block: 'nearest' });
  }, [activeRow]);

  const nothing = Boolean(q) && rows.length === 0 && !loadingSaves && !failed && catalogState.status === 'ready';

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Keep the caret where it is and the page behind from scrolling.
      e.preventDefault();
      if (rows.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (step === 1 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length);
    } else if (e.key === 'Enter' && activeRow) {
      e.preventDefault();
      // Clicking the row's own link opens it the way a pointer would: in this tab, or a new one when external.
      document.getElementById(activeRow.id)?.click();
    }
  };

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          gap: 1.5,
          pl: 1.25,
          pr: { xs: 0.5, sm: 1.25 },
          minHeight: { xs: layout.touchTarget, sm: layout.topBarHeight },
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <InputBase
          autoFocus
          fullWidth
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0); // the best match is active; with no results there is no row to point at
          }}
          onKeyDown={onKeyDown}
          placeholder="Search benchmarks, blueprints, tools, posts and save files"
          sx={{ fontSize: 16, minWidth: 0 }}
          inputProps={{
            role: 'combobox',
            'aria-label': 'Search the site',
            'aria-expanded': rows.length > 0,
            'aria-controls': listId,
            'aria-activedescendant': activeRow?.id,
            'aria-autocomplete': 'list',
            autoComplete: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />
        <IconButton
          aria-label="Close search"
          onClick={onClose}
          sx={{ display: { xs: 'flex', sm: 'none' }, width: layout.touchTarget, height: layout.touchTarget }}
        >
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {!q && <Box sx={mutedLine}>Start typing to search the whole site.</Box>}
        {nothing && (
          <Box role="status" sx={mutedLine}>
            Nothing matches “{q}”.
          </Box>
        )}
        {q && (
          <Box role="listbox" id={listId} aria-label="Search results">
            {groups.map((g) => (
              <Box key={g.kind} role="group" aria-labelledby={`${uid}-heading-${g.kind}`}>
                <Box
                  id={`${uid}-heading-${g.kind}`}
                  role="presentation"
                  sx={{
                    px: 1.25,
                    pt: 1.5,
                    pb: 0.5,
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: 1,
                    lineHeight: 1.5,
                    textTransform: 'uppercase',
                    color: 'primary.main',
                  }}
                >
                  {g.label}
                </Box>
                {g.rows.map((row) => (
                  <ResultRow
                    key={row.id}
                    row={row}
                    selected={row === activeRow}
                    onHover={() => setActive(rows.indexOf(row))}
                    onOpen={onClose}
                  />
                ))}
                {g.message && (
                  <Box role="presentation" sx={mutedLine}>
                    {g.message}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </>
  );
}

const truncate = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

function ResultRow({
  row,
  selected,
  onHover,
  onOpen,
}: {
  row: Row;
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  const { entry, all } = row;
  const link = entry.external
    ? { component: 'a', href: entry.to, target: '_blank', rel: 'noopener noreferrer' }
    : { component: RouterLink, to: entry.to };
  return (
    <Box
      {...link}
      id={row.id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      // Mouse movement, not enter: a row scrolling under a resting pointer must not steal the active row.
      onMouseMove={() => !selected && onHover()}
      onClick={onOpen}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1.25,
        py: 0.5,
        minHeight: { xs: layout.touchTarget, md: entry.detail ? layout.rowHeightTwoLine : layout.rowHeight },
        fontSize: 14,
        color: all ? 'primary.main' : 'text.primary',
        textDecoration: 'none',
        outline: 'none',
        '&[aria-selected="true"]': { backgroundColor: 'action.selected' },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ fontWeight: all ? 400 : 600, ...truncate }}>{entry.title}</Box>
        {entry.detail && <Box sx={{ fontSize: 12.5, color: 'text.secondary', ...truncate }}>{entry.detail}</Box>}
      </Box>
      {entry.external && <OpenInNewIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />}
    </Box>
  );
}
