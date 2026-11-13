/**
 * Build-time conversion of published raster images (PNG, JPEG) to WebP, shared by the content sync.
 *
 * - Never wider than MAX_WIDTH; smaller images keep their size (no upscaling).
 * - Few colours (charts, UI crops: at most LOSSLESS_MAX_COLORS distinct colours after resizing)
 *   → lossless, which is pixel-exact and, for such images, smaller than lossy at any useful quality.
 * - Everything else (game screenshots) → lossy at LOSSY_QUALITY with smart chroma subsampling,
 *   which keeps thin red/green circuit wires and small UI text from bleeding.
 * - Animated PNGs are not converted (see isAnimatedPng); GIFs and SVGs never reach this module.
 *
 * The output depends only on the input bytes and the sharp/libvips/libwebp versions in the
 * lockfile, so a build is reproducible.
 */
import { openSync, readSync, closeSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import sharp from 'sharp';

export const MAX_WIDTH = 1600;
export const LOSSY_QUALITY = 82;
export const LOSSLESS_MAX_COLORS = 4096;

// One image per worker; libvips' own thread pool would only contend with the other workers.
sharp.concurrency(1);
sharp.cache(false);

/** @param {string} rel */
export function isConvertible(rel) {
  return /\.(png|jpe?g)$/i.test(rel);
}

/** @param {string} rel - `a/b.png` → `a/b.webp` */
export function webpName(rel) {
  return rel.replace(/\.[^./]+$/, '.webp');
}

/**
 * Whether a PNG is an APNG (has an `acTL` chunk before its first `IDAT`). Reads only chunk headers.
 *
 * @param {string} file
 */
export function isAnimatedPng(file) {
  if (!/\.png$/i.test(file)) return false;
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    let pos = 8; // PNG signature
    for (;;) {
      if (readSync(fd, head, 0, 8, pos) < 8) return false;
      const type = head.toString('latin1', 4, 8);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      pos += 12 + head.readUInt32BE(0);
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * @param {Buffer} data - raw pixels
 * @param {number} channels
 * @param {number} limit
 * @returns {number} distinct colours, or limit + 1 once there are more than `limit`
 */
function countColors(data, channels, limit) {
  const seen = new Set();
  for (let i = 0; i < data.length; i += channels) {
    let c = 0;
    for (let k = 0; k < channels; k++) c = c * 256 + data[i + k];
    seen.add(c);
    if (seen.size > limit) break;
  }
  return seen.size;
}

/**
 * @param {string} src
 * @param {string} dest
 * @returns {Promise<{ lossless: boolean, bytesIn: number, bytesOut: number }>}
 */
export async function convertToWebp(src, dest) {
  const { data, info } = await sharp(src)
    .rotate() // apply EXIF orientation, which is dropped with the rest of the metadata
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lossless = countColors(data, info.channels, LOSSLESS_MAX_COLORS) <= LOSSLESS_MAX_COLORS;
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const options = lossless
    ? { lossless: true, effort: 4 }
    : { quality: LOSSY_QUALITY, alphaQuality: 100, smartSubsample: true, effort: 4 };
  await sharp(data, { raw }).webp(options).toFile(dest);
  const [{ size: bytesIn }, { size: bytesOut }] = await Promise.all([fs.stat(src), fs.stat(dest)]);
  return { lossless, bytesIn, bytesOut };
}

/**
 * Run `fn` over `items`, at most `limit` at a time; results in input order.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T) => Promise<R>} fn
 * @param {number} [limit]
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, fn, limit = Math.max(1, os.availableParallelism())) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
