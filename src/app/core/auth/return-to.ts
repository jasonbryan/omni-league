// Where the browser goes after sign-up or sign-in (ADR 0008 "Return-to-registration URL").
// Shared by sign-up (#62) and sign-in (#63).

/** Where sign-up and sign-in land when there is no `returnTo`. */
export const AFTER_AUTH_DEFAULT = '/app';

/** Any origin that cannot be this site's; only used to see whether a path leaves it. */
const PLACEHOLDER_ORIGIN = 'https://return-to.invalid';

/**
 * `raw` as a same-site path, or `/`. Accepted only when it starts with `/`, does not start with
 * `//` or `/\` (both name another host), and, parsed against a placeholder origin, keeps that
 * origin (the URL parser drops tabs and newlines, so `/\t/evil.example` is caught here). The result
 * is the parsed path, query, and fragment, so what the router gets is what was checked.
 */
export function safeReturnTo(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return '/';
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The validated `returnTo`, or `/app` when the page was opened without one. */
export function afterAuthUrl(returnTo: string | null | undefined): string {
  return returnTo === null || returnTo === undefined ? AFTER_AUTH_DEFAULT : safeReturnTo(returnTo);
}
