const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);

/** A non-empty video link must be an http(s) URL of one YouTube or Vimeo video. */
export function isVideoLink(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter((part) => part.length > 0);

  if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch' || url.pathname === '/watch/') {
      const id = url.searchParams.get('v');
      return id !== null && id.trim() !== '';
    }
    return (
      parts.length === 2 &&
      (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') &&
      parts[1]!.length > 0
    );
  }
  if (host === 'youtu.be') return parts.length === 1;
  if (VIMEO_HOSTS.has(host))
    return parts.length === 1 && /^\d+$/.test(parts[0]!);
  if (host === 'player.vimeo.com') {
    return (
      parts.length === 2 && parts[0] === 'video' && /^\d+$/.test(parts[1]!)
    );
  }
  return false;
}
