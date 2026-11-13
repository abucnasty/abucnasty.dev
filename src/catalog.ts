// The blueprint catalog, fetched in the browser from the live vault on every
// page load (never baked into the build). Types and URL helpers live in
// catalogCore.ts and are re-exported here.
import { useCallback, useEffect, useState } from 'react';
import { CATALOG_URL, normaliseCatalog, type Catalog } from './catalogCore';

export * from './catalogCore';

let pending: Promise<Catalog> | null = null;
let loaded: Catalog | null = null;

/** One fetch per page load, shared by every caller; a failed fetch is forgotten so the next call retries. */
export function loadCatalog(): Promise<Catalog> {
  pending ??= fetch(CATALOG_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
      return res.json();
    })
    .then((json) => (loaded = normaliseCatalog(json)))
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

export type CatalogState =
  | { status: 'loading'; catalog: null; retry: () => void }
  | { status: 'ready'; catalog: Catalog; retry: () => void }
  | { status: 'failed'; catalog: null; retry: () => void };

/** The catalog for a component: starts the shared fetch on mount. */
export function useCatalog(): CatalogState {
  const [catalog, setCatalog] = useState<Catalog | null>(loaded);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (catalog) return;
    let live = true;
    loadCatalog().then(
      (c) => live && setCatalog(c),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [catalog, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  if (catalog) return { status: 'ready', catalog, retry };
  return { status: failed ? 'failed' : 'loading', catalog: null, retry };
}
