#!/usr/bin/env node
/**
 * Blog image sync: copies all images from src/blog/posts/<slug>/
 * to public/blog/posts/<slug>/ so they can be served and previewed.
 *
 * This allows blog posts to be co-located with their images in src/,
 * while still being served by Vite from public/.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SRC_POSTS = path.join(ROOT, 'src/blog/posts');
const PUBLIC_POSTS = path.join(ROOT, 'public/blog/posts');

async function syncBlogImages() {
  try {
    // Ensure public/blog/posts exists
    await fs.mkdir(PUBLIC_POSTS, { recursive: true });

    // List all post directories/files
    const entries = await fs.readdir(SRC_POSTS, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(SRC_POSTS, entry.name);
      const destPostDir = path.join(PUBLIC_POSTS, entry.name);

      if (entry.isDirectory()) {
        // Copy all files from src/blog/posts/<dir>/ to public/blog/posts/<dir>/
        await fs.mkdir(destPostDir, { recursive: true });
        await copyDirRecursive(srcPath, destPostDir);
      }
      // Note: flat .md/.tsx files don't need copying since they're not served as static assets
    }

    console.log('✓ Blog images synced successfully');
  } catch (err) {
    console.error('✗ Error syncing blog images:', err);
    process.exit(1);
  }
}

/**
 * Recursively copy directory, excluding TypeScript/JSX source files.
 */
async function copyDirRecursive(src, dest) {
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip source files
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      continue;
    }

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

syncBlogImages();
