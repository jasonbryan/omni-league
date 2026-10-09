// Preview origin pattern (ADR 0010 "Auth items", ADR 0008, #15). Single source: the Convex default
// preview variable PREVIEW_ORIGIN_PATTERN holds this exact string (docs/process/hosting.md quotes
// it), and the auth code imports this constant rather than restating it.

/** The Netlify project's `netlify.app` subdomain, `<site>` in every hostname below. */
export const NETLIFY_SITE = 'charming-longma-28c00d';

/** `value` with every regular-expression metacharacter escaped (`-` needs none outside a class). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Anchored pattern for the browser origins of this project's deploy previews
 * (`deploy-preview-<PR number>--<site>`), staging (`main--<site>`), and deploy permalinks
 * (`<24-hex deploy id>--<site>`), all on `https://…netlify.app`. It never matches the bare
 * production host, another Netlify project, `http:`, or a lookalike suffix.
 */
export const PREVIEW_ORIGIN_PATTERN =
  String.raw`^https://(deploy-preview-[1-9][0-9]*|main|[0-9a-f]{24})--` +
  escapeRegExp(NETLIFY_SITE) +
  String.raw`\.netlify\.app$`;
