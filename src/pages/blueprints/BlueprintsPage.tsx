// The Blueprints page: an index of names beside one big plate that takes the
// shape of the build. Everything comes from the live catalog.
import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import { useCallback, useEffect, useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { blueprintRoute, useCatalog } from '../../catalog';
import { IndexColumn } from './IndexColumn';
import { findEntry, newestEntry } from './model';
import { Stage, StageMessage, type Measured } from './Stage';
import { colors } from './tokens';

export function BlueprintsPage() {
  const path = (useParams()['*'] ?? '').replace(/^\/+|\/+$/g, '');
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const nodePath = params.get('entry')?.replace(/^\/+|\/+$/g, '') || null;
  const desktop = useMediaQuery(useTheme().breakpoints.up('md'), { noSsr: true });
  const state = useCatalog();
  const [query, setQuery] = useState('');
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [measured, setMeasured] = useState<Measured>({});

  const onMeasured = useCallback((src: string, width: number, height: number) => {
    setMeasured((m) => (m[src]?.width === width && m[src]?.height === height ? m : { ...m, [src]: { width, height } }));
  }, []);

  // A new build starts at the top of the page; picking an entry of the same book does not move it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  const found = state.status === 'ready' && path ? findEntry(state.catalog, path) : null;
  if (found?.moved) {
    return <Navigate replace to={{ pathname: blueprintRoute(found.entry.path), search: params.toString() ? `?${params}` : '', hash }} />;
  }

  const index = (
    <IndexColumn
      state={state}
      selectedPath={found ? found.entry.path : null}
      query={query}
      onQuery={setQuery}
      showDeprecated={showDeprecated}
      onShowDeprecated={setShowDeprecated}
      phone={!desktop}
    />
  );

  let stage;
  if (state.status === 'loading') stage = <StageMessage kind="loading" phone={!desktop} />;
  else if (state.status === 'failed') stage = <StageMessage kind="failed" phone={!desktop} onRetry={state.retry} />;
  else if (path && !found) stage = <StageMessage kind="unknown" phone={!desktop} />;
  else {
    const entry = found?.entry ?? newestEntry(state.catalog);
    stage = entry ? (
      <Stage key={entry.path} entry={entry} nodePath={found ? nodePath : null} phone={!desktop} measured={measured} onMeasured={onMeasured} />
    ) : null;
  }

  if (!desktop) {
    // Phones: the index alone at /blueprints, the build alone at /blueprints/<path>.
    if (path) return <Box sx={{ width: '100%', minWidth: 0, backgroundColor: colors.void }}>{stage}</Box>;
    return (
      <Box sx={{ width: '100%', minWidth: 0, backgroundColor: colors.panel }}>
        {index}
        {state.status === 'failed' && <StageMessage kind="failed" phone back={false} onRetry={state.retry} />}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', width: '100%', minWidth: 0, backgroundColor: colors.void }}>
      {index}
      {stage}
    </Box>
  );
}
