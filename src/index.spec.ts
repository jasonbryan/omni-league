import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(process.cwd(), 'src/index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');

// The product name is "Omni League" (two words) in every user-visible place (owner, #10).
describe('src/index.html', () => {
  it('sets the document title to "Omni League"', () => {
    expect(doc.title).toBe('Omni League');
  });

  // Install tags (#80, ADR 0013): every server, prerendered, and client page carries them because
  // they sit in the one index.html. Hrefs are relative to <base href="/">.
  describe('install tags', () => {
    it('links the web app manifest', () => {
      const link = doc.head.querySelector('link[rel="manifest"]');

      expect(link?.getAttribute('href')).toBe('manifest.webmanifest');
      expect(existsSync(join(process.cwd(), 'public', 'manifest.webmanifest'))).toBe(true);
    });

    it('sets the theme colour to white, matching the top bar', () => {
      const meta = doc.head.querySelector('meta[name="theme-color"]');

      expect(meta?.getAttribute('content')).toBe('#ffffff');
    });

    it('links the 180px apple-touch icon', () => {
      const link = doc.head.querySelector('link[rel="apple-touch-icon"]');

      expect(link?.getAttribute('href')).toBe('icons/apple-touch-icon.png');
      expect(existsSync(join(process.cwd(), 'public', 'icons', 'apple-touch-icon.png'))).toBe(true);
    });

    it('sets the Home Screen name on iPhone to "Omni League"', () => {
      const meta = doc.head.querySelector('meta[name="apple-mobile-web-app-title"]');

      expect(meta?.getAttribute('content')).toBe('Omni League');
    });

    it('sets no startup images and no status bar style (approved mockup)', () => {
      expect(doc.head.querySelector('link[rel="apple-touch-startup-image"]')).toBeNull();
      expect(
        doc.head.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
      ).toBeNull();
    });

    it('keeps the favicon link', () => {
      const link = doc.head.querySelector('link[rel="icon"]');

      expect(link?.getAttribute('href')).toBe('favicon.ico');
    });
  });
});
