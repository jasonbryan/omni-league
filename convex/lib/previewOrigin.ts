export const NETLIFY_SITE = 'charming-longma-28c00d';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// Anchored: never matches the production host, another Netlify project, `http:`, or a lookalike
// suffix.
export const PREVIEW_ORIGIN_PATTERN =
  String.raw`^https://(deploy-preview-[1-9][0-9]*|main|[0-9a-f]{24})--` +
  escapeRegExp(NETLIFY_SITE) +
  String.raw`\.netlify\.app$`;
