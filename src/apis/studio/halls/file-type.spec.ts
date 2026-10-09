import {
  fileRejection,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
} from './file-type.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const gif = Buffer.from('GIF89a');
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
]);
const webm = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from('webm'),
]);
const mp4 = Buffer.alloc(16);
mp4.writeUInt32BE(16, 0);
mp4.write('ftyp', 4, 'ascii');
mp4.write('isom', 8, 'ascii');

describe('fileRejection', () => {
  it('accepts jpeg, png, gif, webp, mp4, and webm', () => {
    for (const header of [jpeg, png, gif, webp, mp4, webm]) {
      expect(fileRejection(header.length, header, false)).toBeNull();
    }
  });

  it('rejects an empty file, a file that is too large, and an unknown type', () => {
    expect(fileRejection(0, Buffer.alloc(0), false)).toBe('TOO_SMALL');
    expect(fileRejection(8, Buffer.from('not-a-file'), false)).toBe(
      'INVALID_VALUE',
    );
    expect(fileRejection(IMAGE_MAX_BYTES + 1, jpeg, false)).toBe('TOO_BIG');
    expect(fileRejection(VIDEO_MAX_BYTES, mp4, true)).toBe('TOO_BIG');
    expect(fileRejection(IMAGE_MAX_BYTES, jpeg, false)).toBeNull();
    expect(fileRejection(VIDEO_MAX_BYTES, mp4, false)).toBeNull();
  });
});
