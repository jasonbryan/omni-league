import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Node built-ins only: a PNG's width and height are the two big-endian integers after its 8-byte signature and the IHDR chunk header.
const publicDir = join(process.cwd(), 'public');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

function pngSize(file: Buffer): { width: number; height: number } {
  expect(file.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(file.toString('latin1', 12, 16)).toBe('IHDR');
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

describe('public/manifest.webmanifest', () => {
  const manifest = JSON.parse(
    readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8'),
  ) as Record<string, unknown>;

  it('has exactly the fields and values of the approved scope', () => {
    expect(manifest).toEqual({
      id: '/',
      name: 'Omni League',
      short_name: 'Omni League',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#ffffff',
      background_color: '#f6f7fa',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: 'icons/icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    });
  });

  it('names icon files whose pixel size is the declared size', () => {
    for (const icon of manifest['icons'] as ManifestIcon[]) {
      const { width, height } = pngSize(readFileSync(join(publicDir, icon.src)));

      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it('keeps the icons in public/icons/ under plain names', () => {
    // src/public-assets.spec.ts rejects the content-hashed names; this pins the directory.
    for (const icon of manifest['icons'] as ManifestIcon[]) {
      expect(icon.src).toMatch(/^icons\/[a-z0-9-]+\.png$/);
    }
  });
});

describe('public/icons/apple-touch-icon.png', () => {
  it('is 180 by 180 pixels', () => {
    expect(pngSize(readFileSync(join(publicDir, 'icons', 'apple-touch-icon.png')))).toEqual({
      width: 180,
      height: 180,
    });
  });
});
