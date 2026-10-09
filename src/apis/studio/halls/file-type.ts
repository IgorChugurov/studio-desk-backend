export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
  'MSNV',
]);

export type FileRejection = 'TOO_SMALL' | 'TOO_BIG' | 'INVALID_VALUE';

/** The type is read from the bytes, not from the browser's declared type. */
export function detectContentType(bytes: Buffer): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (bytes.length >= PNG.length && bytes.subarray(0, PNG.length).equals(PNG)) {
    return 'image/png';
  }
  if (bytes.length >= 6) {
    const gif = bytes.subarray(0, 6).toString('ascii');
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (isMp4(bytes)) return 'video/mp4';
  if (isWebm(bytes)) return 'video/webm';
  return null;
}

export function fileRejection(
  size: number,
  header: Buffer,
  truncated: boolean,
): FileRejection | null {
  if (size === 0) return 'TOO_SMALL';
  if (truncated || size > VIDEO_MAX_BYTES) return 'TOO_BIG';
  const contentType = detectContentType(header);
  if (!contentType) return 'INVALID_VALUE';
  if (contentType.startsWith('image/') && size > IMAGE_MAX_BYTES)
    return 'TOO_BIG';
  return null;
}

function isMp4(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
    return false;
  }
  const brands = [bytes.subarray(8, 12).toString('ascii')];
  for (let offset = 16; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
    brands.push(bytes.subarray(offset, offset + 4).toString('ascii'));
  }
  return brands.some((brand) => MP4_BRANDS.has(brand));
}

function isWebm(bytes: Buffer): boolean {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x1a ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0xdf ||
    bytes[3] !== 0xa3
  ) {
    return false;
  }
  const head = bytes
    .subarray(0, Math.min(bytes.length, 4096))
    .toString('binary');
  if (head.includes('matroska')) return false;
  return head.includes('webm');
}
