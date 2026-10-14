export const AFTER_AUTH_DEFAULT = '/app';

const PLACEHOLDER_ORIGIN = 'https://return-to.invalid';

function namesAnotherHost(path: string): boolean {
  return path.startsWith('//') || path.startsWith('/\\');
}

/**
 * The URL parser drops tabs and newlines and turns `\` into `/`, so the checks run on the raw input and again on the parsed result:
 * dot segments (`/..//evil.example`, `/%2e%2e//…`, `/./\…`) parse to `//evil.example`, which becomes `/`.
 */
export function safeReturnTo(raw: string): string {
  return validReturnTo(raw) ?? '/';
}

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

export function afterAuthUrl(returnTo: string | null | undefined): string {
  return returnTo === null || returnTo === undefined ? AFTER_AUTH_DEFAULT : safeReturnTo(returnTo);
}

export function returnToOrApp(returnTo: string | null | undefined): string {
  if (returnTo === null || returnTo === undefined) return AFTER_AUTH_DEFAULT;
  return validReturnTo(returnTo) ?? AFTER_AUTH_DEFAULT;
}
