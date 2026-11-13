import { Suspense, lazy } from 'react';
import { CircularProgress } from '@mui/material';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Home } from './pages/Home';
import { BenchmarksIndex } from './pages/BenchmarksIndex';
import { BenchmarkDetail } from './pages/BenchmarkDetail';
import { About } from './pages/About';
import { Tools } from './pages/Tools';
import { BlogIndex } from './pages/BlogIndex';
import { BlogPost } from './pages/BlogPost';
import { NotFound } from './pages/NotFound';
import { loadSaveTree } from './saves';
import { loadCatalog } from './catalog';

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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}
