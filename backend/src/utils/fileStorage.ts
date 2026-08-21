import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Local file storage for uploaded images.
 *
 * The smallest thing that works with this backend: files are written under
 * backend/uploads and served read-only by express.static, and only the URL is
 * kept in the database. No image bytes are ever stored in a table.
 *
 * Swapping this for S3 or another object store later means changing one
 * function — everything else deals in the returned URL.
 */

/** Absolute path of the upload root. */
export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

/** The URL prefix express.static is mounted on. */
export const UPLOAD_URL_PREFIX = '/uploads';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Only image types the WhatsApp media endpoint also accepts. */
export function isSupportedImageMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXTENSION_BY_MIME, mime);
}

/**
 * Writes a base64 image into `uploads/<folder>/` and returns both the public
 * URL to store and the absolute path for anything that has to read the bytes
 * back (the WhatsApp upload does).
 *
 * The filename is randomised rather than derived from client input, so a
 * crafted name cannot escape the folder or overwrite an existing file.
 */
export async function saveBase64Image(
  folder: string,
  base64: string,
  mimeType: string
): Promise<{ url: string; absolutePath: string; bytes: number }> {
  if (!isSupportedImageMime(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }

  // Tolerate a data: URI as well as a bare base64 payload.
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length === 0) {
    throw new Error('Image data is empty');
  }

  const safeFolder = folder.replace(/[^a-z0-9_-]/gi, '');
  const directory = path.join(UPLOAD_ROOT, safeFolder);
  await fs.promises.mkdir(directory, { recursive: true });

  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXTENSION_BY_MIME[mimeType]}`;
  const absolutePath = path.join(directory, name);
  await fs.promises.writeFile(absolutePath, buffer);

  return {
    url: `${UPLOAD_URL_PREFIX}/${safeFolder}/${name}`,
    absolutePath,
    bytes: buffer.length,
  };
}

/**
 * Resolves a stored URL back to a path on disk, refusing anything that points
 * outside the upload root.
 */
export function absolutePathForUrl(url: string): string | null {
  if (!url.startsWith(`${UPLOAD_URL_PREFIX}/`)) return null;
  const relative = url.slice(UPLOAD_URL_PREFIX.length + 1);
  const resolved = path.resolve(UPLOAD_ROOT, relative);
  if (!resolved.startsWith(UPLOAD_ROOT)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}
