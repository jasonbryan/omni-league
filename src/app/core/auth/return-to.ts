// Where the browser goes after sign-up or sign-in (ADR 0008 "Return-to-registration URL").
// Shared by sign-up (#62) and sign-in (#63).

/** Where sign-up and sign-in land when there is no `returnTo`. */
export const AFTER_AUTH_DEFAULT = '/app';

/** Any origin that cannot be this site's; only used to see whether a path leaves it. */
const PLACEHOLDER_ORIGIN = 'https://return-to.invalid';

/** True when `path` names another host: `//host` or `/\host` (both protocol-relative). */
function namesAnotherHost(path: string): boolean {
  return path.startsWith('//') || path.startsWith('/\\');
}

/**
 * `raw` as a same-site path, or `/`. ADR 0008's checks run on the raw input: it must start with
 * `/`, must not start with `//` or `/\`, and, parsed against a placeholder origin, must keep that
 * origin (the URL parser drops tabs and newlines, so `/\t/evil.example` is caught here). The result
 * is the parsed path, query, and fragment, so the same checks run on it too: dot segments
 * (`/..//evil.example`, `/%2e%2e//…`, `/./\…`) parse to `//evil.example`, which is turned into `/`.
 * The parser turns `\` into `/` and removes dot segments, so a result never holds either, and it
 * resolves to this site's origin against any base.
 */
export function safeReturnTo(raw: string): string {
  return validReturnTo(raw) ?? '/';
}

/** `raw` as `safeReturnTo` would return it, or `null` when `safeReturnTo` would refuse it. */
function validReturnTo(raw: string): string | null {
  if (!raw.startsWith('/') || namesAnotherHost(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN || namesAnotherHost(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The validated `returnTo`, or `/app` when the page was opened without one. */
export function afterAuthUrl(returnTo: string | null | undefined): string {
  return returnTo === null || returnTo === undefined ? AFTER_AUTH_DEFAULT : safeReturnTo(returnTo);
}

/**
 * The validated `returnTo`, and `/app` when there is none or it is not valid (#63). It is where a
 * visitor who is already signed in goes from /sign-in or /sign-up, and the `returnTo` the links
 * between those two pages and the top bar's "Sign in" carry. After a sign-in or sign-up itself an
 * unsafe `returnTo` lands on `/` instead (`afterAuthUrl`).
 */
export function returnToOrApp(returnTo: string | null | undefined): string {
  if (returnTo === null || returnTo === undefined) return AFTER_AUTH_DEFAULT;
  return validReturnTo(returnTo) ?? AFTER_AUTH_DEFAULT;
}
