import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { NETLIFY_SITE, PREVIEW_ORIGIN_PATTERN } from './previewOrigin';

const pattern = new RegExp(PREVIEW_ORIGIN_PATTERN);

describe('PREVIEW_ORIGIN_PATTERN', () => {
  test('is built for this Netlify project', () => {
    expect(NETLIFY_SITE).toBe('charming-longma-28c00d');
    expect(PREVIEW_ORIGIN_PATTERN).toBe(
      String.raw`^https://(deploy-preview-[1-9][0-9]*|main|[0-9a-f]{24})--charming-longma-28c00d\.netlify\.app$`,
    );
  });

  const SITE = 'charming-longma-28c00d';
  const PREVIEW_AND_PERMALINK_ORIGINS = [
    `https://deploy-preview-54--${SITE}.netlify.app`,
    `https://6ac85c819a0329a74a7f3ae6--${SITE}.netlify.app`,
    `https://deploy-preview-15--${SITE}.netlify.app`,
    `https://deploy-preview-1--${SITE}.netlify.app`,
    `https://deploy-preview-1024--${SITE}.netlify.app`,
  ];
  const STAGING_ORIGINS = [`https://main--${SITE}.netlify.app`];
  const DEPLOY_PERMALINK_ORIGINS = [`https://0123456789abcdef01234567--${SITE}.netlify.app`];
  const PRODUCTION_HOST_ORIGINS = [`https://${SITE}.netlify.app`, 'https://netlify.app'];
  const OTHER_PROJECT_ORIGINS = [
    'https://deploy-preview-1--other.netlify.app',
    'https://main--other.netlify.app',
  ];
  const NOT_HTTPS_ORIGINS = [`http://deploy-preview-1--${SITE}.netlify.app`];
  const LOOKALIKE_ORIGINS = [
    `https://deploy-preview-1--${SITE}.netlify.app.evil.example`,
    `https://evil.example/https://deploy-preview-1--${SITE}.netlify.app`,
    `https://x.deploy-preview-1--${SITE}.netlify.app`,
  ];
  const LEADING_ZERO_PR_NUMBER_ORIGINS = [
    `https://deploy-preview-0--${SITE}.netlify.app`,
    `https://deploy-preview-01--${SITE}.netlify.app`,
  ];
  const OTHER_BRANCH_AND_MALFORMED_ID_ORIGINS = [
    `https://feature-x--${SITE}.netlify.app`,
    `https://0123456789abcdef0123456--${SITE}.netlify.app`,
    `https://0123456789ABCDEF01234567--${SITE}.netlify.app`,
  ];
  const LITERAL_DOT_AND_NO_PATH_OR_PORT_ORIGINS = [
    'https://main--charming-longma-28c00dXnetlify.app',
    `https://main--${SITE}.netlifyXapp`,
    `https://main--${SITE}.netlify.app/`,
    `https://main--${SITE}.netlify.app:8443`,
  ];

  test.each([...PREVIEW_AND_PERMALINK_ORIGINS, ...STAGING_ORIGINS, ...DEPLOY_PERMALINK_ORIGINS])(
    'matches %s',
    (origin) => {
      expect(pattern.test(origin)).toBe(true);
    },
  );

  test.each([
    ...PRODUCTION_HOST_ORIGINS,
    ...OTHER_PROJECT_ORIGINS,
    ...NOT_HTTPS_ORIGINS,
    ...LOOKALIKE_ORIGINS,
    ...LEADING_ZERO_PR_NUMBER_ORIGINS,
    ...OTHER_BRANCH_AND_MALFORMED_ID_ORIGINS,
    ...LITERAL_DOT_AND_NO_PATH_OR_PORT_ORIGINS,
  ])('does not match %s', (origin) => {
    expect(pattern.test(origin)).toBe(false);
  });
});

test('docs/process/hosting.md quotes the same pattern and names this file', () => {
  const doc = readFileSync(new URL('../../docs/process/hosting.md', import.meta.url), 'utf8');
  expect(doc).toContain('`convex/lib/previewOrigin.ts`');
  expect(doc).toContain(PREVIEW_ORIGIN_PATTERN);
});
