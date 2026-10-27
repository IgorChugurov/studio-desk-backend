const USERNAME = /^[A-Za-z0-9._]+$/;

function httpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function partsOf(url: URL): string[] {
  return url.pathname.split('/').filter((part) => part.length > 0);
}

/** An Instagram profile address: instagram.com/{username}. */
export function isInstagramLink(value: string): boolean {
  const url = httpUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (host !== 'instagram.com' && host !== 'www.instagram.com') return false;
  const parts = partsOf(url);
  return parts.length === 1 && USERNAME.test(parts[0]!);
}

/** A TikTok profile address: tiktok.com/@{username}. */
export function isTikTokLink(value: string): boolean {
  const url = httpUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (host !== 'tiktok.com' && host !== 'www.tiktok.com') return false;
  const parts = partsOf(url);
  if (parts.length !== 1 || !parts[0]!.startsWith('@')) return false;
  return USERNAME.test(parts[0]!.slice(1));
}
