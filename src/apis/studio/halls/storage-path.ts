import { open } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { loadEnv } from '../../../config/env.js';

export function storageRoot(): string {
  return resolve(loadEnv().FILE_STORAGE_DIR);
}

const FILE_PREFIX = '/files/';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

/** Public address stored on the file row and returned in `images.url`. */
export function fileAddress(
  hallId: string,
  fileId: string,
  contentType: string,
): string {
  const extension = EXTENSIONS[contentType];
  if (!extension) throw new Error(`No extension for ${contentType}`);
  return `${FILE_PREFIX}halls/${hallId}/${fileId}${extension}`;
}

/** Disk path for a stored public address. */
export function diskPathOfAddress(address: string): string {
  if (!address.startsWith(FILE_PREFIX)) {
    throw new Error('File path escapes storage');
  }
  return absoluteStoragePath(address.slice(FILE_PREFIX.length));
}

/** A path inside the storage directory. Rejects a relative path that escapes it. */
export function absoluteStoragePath(relative: string): string {
  const root = storageRoot();
  const absolute = resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error('File path escapes storage');
  }
  return absolute;
}

export async function readFileHeader(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
