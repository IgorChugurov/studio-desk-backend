import { isInstagramLink, isTikTokLink } from './social-link.js';

describe('social links', () => {
  it('accepts an Instagram or TikTok profile', () => {
    expect(isInstagramLink('https://instagram.com/anna.yoga')).toBe(true);
    expect(isInstagramLink('https://www.instagram.com/anna/')).toBe(true);
    expect(isTikTokLink('https://www.tiktok.com/@anna')).toBe(true);
    expect(isTikTokLink('http://tiktok.com/@anna.yoga/')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isInstagramLink('https://instagram.com')).toBe(false);
    expect(isInstagramLink('https://instagram.com/p/abc')).toBe(false);
    expect(isTikTokLink('https://tiktok.com/anna')).toBe(false);
    expect(isTikTokLink('https://vm.tiktok.com/abc')).toBe(false);
  });
});
