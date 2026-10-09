import { isVideoLink } from './video-link.js';

describe('isVideoLink', () => {
  it('accepts a YouTube or Vimeo video address', () => {
    const accepted = [
      'https://www.youtube.com/watch?v=abc',
      'https://youtube.com/watch?v=abc',
      'https://m.youtube.com/watch?v=abc',
      'https://www.youtube.com/embed/abc',
      'https://www.youtube.com/shorts/abc',
      'https://www.youtube.com/live/abc',
      'https://youtu.be/abc',
      'http://vimeo.com/123',
      'https://www.vimeo.com/123',
      'https://player.vimeo.com/video/123',
    ];
    expect(accepted.filter((value) => !isVideoLink(value))).toEqual([]);
  });

  it('rejects anything else', () => {
    const rejected = [
      'https://example.com/watch?v=abc',
      'https://youtube.com',
      'https://youtube.com/watch',
      'https://youtube.com/watch?v=',
      'https://youtu.be',
      'https://vimeo.com/channels',
      'https://vimeo.com/123/extra',
      'notaurl',
    ];
    expect(rejected.filter((value) => isVideoLink(value))).toEqual([]);
  });
});
