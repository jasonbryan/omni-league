import { describe, expect, test } from 'vitest';
import {
  checkLogoPick,
  detectLogoType,
  formatFileSize,
  LOGO_HEAD_BYTES,
  LOGO_MAX_BYTES,
  LOGO_MESSAGES,
} from './logoFile';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
const WEBP = bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP'));

describe('detectLogoType', () => {
  test('names a PNG, a JPEG, and a WebP by their first bytes', () => {
    expect(detectLogoType(PNG)).toBe('image/png');
    expect(detectLogoType(JPEG)).toBe('image/jpeg');
    expect(detectLogoType(WEBP)).toBe('image/webp');
  });

  test('refuses SVG, HTML, a GIF, a RIFF file that is not WebP, and an empty file', () => {
    expect(detectLogoType(bytes(...ascii('<svg xmlns="http')))).toBeNull();
    expect(detectLogoType(bytes(...ascii('<!doctype html>')))).toBeNull();
    expect(detectLogoType(bytes(...ascii('GIF89a......')))).toBeNull();
    expect(detectLogoType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull();
    expect(detectLogoType(bytes())).toBeNull();
  });

  test('refuses a PNG signature cut short and a JPEG marker cut short', () => {
    expect(detectLogoType(PNG.slice(0, 7))).toBeNull();
    expect(detectLogoType(JPEG.slice(0, 2))).toBeNull();
    expect(detectLogoType(WEBP.slice(0, 11))).toBeNull();
  });

  test('needs only the first 12 bytes', () => {
    expect(LOGO_HEAD_BYTES).toBe(12);
  });
});

describe('checkLogoPick', () => {
  test('accepts each type at exactly the size limit', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(checkLogoPick({ type, size: LOGO_MAX_BYTES })).toBeNull();
    }
  });

  test('refuses a wrong type with its message, before the size', () => {
    expect(checkLogoPick({ type: 'image/svg+xml', size: 10_000_000 })).toEqual({
      field: 'logo',
      code: 'logoType',
      message: 'Use a PNG, JPEG, or WebP image.',
    });
    expect(checkLogoPick({ type: '', size: 10 })?.code).toBe('logoType');
  });

  test('refuses a file over 256 KB and says how large it is', () => {
    expect(checkLogoPick({ type: 'image/png', size: 1_258_291 })).toEqual({
      field: 'logo',
      code: 'logoSize',
      message: 'Use an image of 256 KB or less. This one is 1.2 MB.',
    });
    expect(checkLogoPick({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })?.message).toBe(
      LOGO_MESSAGES.logoSize(LOGO_MAX_BYTES + 1),
    );
  });

  test('refuses an empty file as the wrong type', () => {
    expect(checkLogoPick({ type: 'image/png', size: 0 })?.code).toBe('logoType');
  });
});

describe('formatFileSize', () => {
  test('uses bytes, KB, and MB with one decimal from 1 MB', () => {
    expect(formatFileSize(512)).toBe('512 bytes');
    expect(formatFileSize(300 * 1024)).toBe('300 KB');
    expect(formatFileSize(1_258_291)).toBe('1.2 MB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB');
  });
});
