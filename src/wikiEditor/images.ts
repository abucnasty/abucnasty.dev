// Images added in the editor, prepared in the browser before they are uploaded with the save:
// PNG, JPEG and WebP up to 10 MB become WebP (longest side at most 1600 px, quality 85; JPEG at
// the same quality on a browser that cannot encode WebP); GIFs up to 5 MB are kept as they are
// (animations survive); anything else is refused. Each gets a name that is unique by its content
// (<name>-<8 hex of its sha256>.<ext>), so two different pictures never share a file.
import { isAttachmentName } from '../wikiSource';

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_GIF_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 1600;
const QUALITY = 0.85;
const CONVERTIBLE = ['image/png', 'image/jpeg', 'image/webp'];

export interface PreparedImage {
  /** File name in the page's _attachments folder. */
  name: string;
  blob: Blob;
  /** An object URL showing it in the editor until the site publishes it. */
  url: string;
}

export class ImageError extends Error {}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** A file name base from the original: letters, digits and "-", at most 40 characters. */
export function nameBase(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]*$/, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  // Clipboard pictures arrive as "image.png".
  return base === '' || base.toLowerCase() === 'image' ? 'image' : base;
}

async function shortHash(blob: Blob): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return [...d.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  let blob: Blob;
  let ext: string;
  if (file.type === 'image/gif') {
    if (file.size > MAX_GIF_BYTES) throw new ImageError(`${file.name} is ${mb(file.size)}; GIFs can be up to 5 MB.`);
    blob = file;
    ext = 'gif';
  } else if (CONVERTIBLE.includes(file.type)) {
    if (file.size > MAX_SOURCE_BYTES) throw new ImageError(`${file.name} is ${mb(file.size)}; images can be up to 10 MB.`);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new ImageError(`${file.name} couldn't be read as an image.`);
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext('2d');
    if (!g) throw new ImageError("This browser can't convert images.");
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const webp = await encode(canvas, 'image/webp');
    if (webp && webp.type === 'image/webp') {
      blob = webp;
      ext = 'webp';
    } else {
      // Safari cannot encode WebP; the vault's CI turns JPEGs into WebP when it publishes.
      const jpeg = await encode(canvas, 'image/jpeg');
      if (!jpeg) throw new ImageError("This browser can't convert images.");
      blob = jpeg;
      ext = 'jpg';
    }
  } else {
    throw new ImageError(`${file.name || 'That file'} isn't a PNG, JPEG, WebP or GIF image.`);
  }
  if (blob.size > MAX_GIF_BYTES) throw new ImageError(`${file.name} is still larger than 5 MB after converting.`);
  const name = `${nameBase(file.name)}-${await shortHash(blob)}.${ext}`;
  if (!isAttachmentName(name)) throw new ImageError(`${file.name} can't be named ${name}.`);
  return { name, blob, url: URL.createObjectURL(blob) };
}
