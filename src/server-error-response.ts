/**
 * Plain-text responses of the SSR entry (`src/server.ts`), carried over from the Express error
 * handler of #30 and #24 / PR #38. Bodies never contain a stack trace, error message, or file path.
 *
 * Web-API-only: this module is bundled into the Netlify edge function, so it must not read the
 * environment or import `node:` modules (enforced by ESLint for `src/server*.ts`).
 */

const TEXT_PLAIN = { 'Content-Type': 'text/plain; charset=utf-8' };

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: TEXT_PLAIN });
}

/** `400 Bad Request`: the request path cannot be percent-decoded (a client error). */
export function badRequestResponse(): Response {
  return textResponse(400, 'Bad Request');
}

/** `404 Not found`: no route matched, so the engine returned `null`. */
export function notFoundResponse(): Response {
  return textResponse(404, 'Not found');
}

/** `500 Internal Server Error`: anything thrown or rejected while handling the request. */
export function internalServerErrorResponse(): Response {
  return textResponse(500, 'Internal Server Error');
}

/**
 * True when the request path (`URL.pathname`, without the query string) has percent-encoding that
 * `decodeURIComponent` rejects. Only the path counts: a malformed query string with a `URIError`
 * means app code threw, which is a 500 (#24 / PR #38).
 */
export function isMalformedPath(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}

/**
 * Error text for the log with every query string replaced by `?<redacted>`: a query string can
 * carry a one-time token (ADR 0008), and error messages and stacks can embed the request URL.
 */
export function redactedErrorText(error: unknown): string {
  const text =
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  return text.replace(/\?\S+/g, '?<redacted>');
}
