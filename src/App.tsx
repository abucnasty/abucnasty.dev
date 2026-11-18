import { Suspense, lazy } from 'react';
import { CircularProgress } from '@mui/material';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { loadSaveTree } from './saves';
import { loadCatalog } from './catalog';
import { loadWikiIndex } from './wiki';
import { loadWikiSession } from './wikiAuth';

// Home is the landing page and stays in the main bundle. Every other page is
// its own chunk, so the first visit downloads only what it shows; the markdown
// renderer and the benchmark index come with the pages that use them.
const BenchmarksIndex = lazy(() => import('./pages/BenchmarksIndex').then((m) => ({ default: m.BenchmarksIndex })));
const BenchmarkDetail = lazy(() => import('./pages/BenchmarkDetail').then((m) => ({ default: m.BenchmarkDetail })));
const About = lazy(() => import('./pages/About').then((m) => ({ default: m.About })));
const Tools = lazy(() => import('./pages/Tools').then((m) => ({ default: m.Tools })));
const BlogIndex = lazy(() => import('./pages/BlogIndex').then((m) => ({ default: m.BlogIndex })));
const BlogPost = lazy(() => import('./pages/BlogPost').then((m) => ({ default: m.BlogPost })));
// The wiki reader (and its markdown pipeline) comes with the wiki pages; its index fetch, and the
// check of who is signed in (for the sign-in footer and an editor's drafts), start alongside.
const WikiPage = lazy(() => {
  loadWikiIndex().catch(() => {}); // the page itself reports a failed load
  void loadWikiSession();
  return import('./pages/WikiPage').then((m) => ({ default: m.WikiPage }));
});
const WikiAll = lazy(() => {
  loadWikiIndex().catch(() => {});
  void loadWikiSession();
  return import('./pages/WikiAll').then((m) => ({ default: m.WikiAll }));
});

// The save browser and its index are split out of the main bundle: only
// visitors to /saves download them. The index starts loading alongside the
// page code rather than after it.
const Saves = lazy(() => {
  loadSaveTree().catch(() => {}); // the page itself reports a failed load
  return import('./pages/Saves').then((m) => ({ default: m.Saves }));
});

// The Blueprints page (and its typeface) is its own chunk; the catalog fetch starts alongside it.
const BlueprintsPage = lazy(() => {
  loadCatalog().catch(() => {}); // the page itself reports a failed load
  return import('./pages/blueprints/BlueprintsPage').then((m) => ({ default: m.BlueprintsPage }));
});

export function App() {
  return (
    <AppShell>
      {/* While a page's chunk loads (once per page per visit) the shell stays up with an empty
          content area; the footer keeps its place at the bottom of the window. */}
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/benchmarks" element={<BenchmarksIndex />} />
          <Route path="/benchmarks/:slug" element={<BenchmarkDetail />} />
          <Route
            path="/saves/*"
            element={
              <Suspense fallback={<CircularProgress />}>
                <Saves />
              </Suspense>
            }
          />
          <Route
            path="/blueprints/*"
            element={
              <Suspense fallback={null}>
                <BlueprintsPage />
              </Suspense>
            }
          />
          <Route path="/about" element={<About />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/blog" element={<BlogIndex />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/wiki" element={<WikiPage />} />
          <Route path="/wiki/all" element={<WikiAll />} />
          <Route path="/wiki/:slug" element={<WikiPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
