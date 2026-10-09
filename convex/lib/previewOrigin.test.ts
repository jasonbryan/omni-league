import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NETLIFY_SITE, PREVIEW_ORIGIN_PATTERN } from './previewOrigin';

// ADR 0010 "Auth items": the anchored pattern for this project's preview, staging, and deploy
// permalink origins (#15). The Convex variable PREVIEW_ORIGIN_PATTERN holds this exact string.

const pattern = new RegExp(PREVIEW_ORIGIN_PATTERN);

describe('PREVIEW_ORIGIN_PATTERN', () => {
  test('is built for this Netlify project', () => {
    expect(NETLIFY_SITE).toBe('charming-longma-28c00d');
    expect(PREVIEW_ORIGIN_PATTERN).toBe(
      String.raw`^https://(deploy-preview-[1-9][0-9]*|main|[0-9a-f]{24})--charming-longma-28c00d\.netlify\.app$`,
    );
  });

  test.each([
    // This PR's (#54) preview origin and its real deploy permalink, then other PR numbers.
    'https://deploy-preview-54--charming-longma-28c00d.netlify.app',
    'https://6ac85c819a0329a74a7f3ae6--charming-longma-28c00d.netlify.app',
    'https://deploy-preview-15--charming-longma-28c00d.netlify.app',
    'https://deploy-preview-1--charming-longma-28c00d.netlify.app',
    'https://deploy-preview-1024--charming-longma-28c00d.netlify.app',
    // Staging.
    'https://main--charming-longma-28c00d.netlify.app',
    // A deploy permalink (24-hex deploy id).
    'https://0123456789abcdef01234567--charming-longma-28c00d.netlify.app',
  ])('matches %s', (origin) => {
    expect(pattern.test(origin)).toBe(true);
  });

  test.each([
    // The bare production host is not a preview origin.
    'https://charming-longma-28c00d.netlify.app',
    'https://netlify.app',
    // Another Netlify project.
    'https://deploy-preview-1--other.netlify.app',
    'https://main--other.netlify.app',
    // Not https.
    'http://deploy-preview-1--charming-longma-28c00d.netlify.app',
    // Lookalike suffix and prefix.
    'https://deploy-preview-1--charming-longma-28c00d.netlify.app.evil.example',
    'https://evil.example/https://deploy-preview-1--charming-longma-28c00d.netlify.app',
    'https://x.deploy-preview-1--charming-longma-28c00d.netlify.app',
    // PR numbers start at 1 and have no leading zero.
    'https://deploy-preview-0--charming-longma-28c00d.netlify.app',
    'https://deploy-preview-01--charming-longma-28c00d.netlify.app',
    // Branch deploys other than main, and malformed deploy ids.
    'https://feature-x--charming-longma-28c00d.netlify.app',
    'https://0123456789abcdef0123456--charming-longma-28c00d.netlify.app',
    'https://0123456789ABCDEF01234567--charming-longma-28c00d.netlify.app',
    // `.` in the site name is literal, and an origin has no path or port.
    'https://main--charming-longma-28c00dXnetlify.app',
    'https://main--charming-longma-28c00d.netlifyXapp',
    'https://main--charming-longma-28c00d.netlify.app/',
    'https://main--charming-longma-28c00d.netlify.app:8443',
  ])('does not match %s', (origin) => {
    expect(pattern.test(origin)).toBe(false);
  });
});

test('docs/process/hosting.md quotes the same pattern and names this file', () => {
  const doc = readFileSync(new URL('../../docs/process/hosting.md', import.meta.url), 'utf8');
  expect(doc).toContain('`convex/lib/previewOrigin.ts`');
  expect(doc).toContain(PREVIEW_ORIGIN_PATTERN);
});
