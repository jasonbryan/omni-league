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
 * `decodeURIComponent` rejects. Only the path counts: the engine renders a path whose query string
 * is malformed without that query string (`hasUndecodableQuery` in `src/app/core/url-serializer.ts`,
 * #91), and a `URIError` from the engine means app code threw, which is a 500 (#24 / PR #38).
 */
export function isMalformedPath(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}

/** Logged when a thrown value cannot be turned into text at all. */
const UNPRINTABLE = '<unprintable thrown value>';

/** Causes logged after the error itself; also ends a cyclic `cause` chain. */
const MAX_CAUSES = 5;

/**
 * Text of one thrown value, always a string. Throws for values that cannot be printed; the caller
 * catches.
 */
function describeThrown(value: unknown): string {
  if (value instanceof Error) {
    // `stack` is an ordinary writable property, so it can hold anything (a number, a Symbol).
    const stack: unknown = value.stack;
    return typeof stack === 'string' ? stack : `${value.name}: ${value.message}`;
  }
  if (typeof value === 'object' && value !== null) {
    // JSON keeps a plain object's fields; a null-prototype object or one without own fields
    // would otherwise give `[object Object]` or throw in String().
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  }
  return String(value);
}

function describeOrFallback(value: unknown): string {
  try {
    return describeThrown(value);
  } catch {
    return UNPRINTABLE;
  }
}

/**
 * Error text for the log with every query string replaced by `?<redacted>`: a query string can
 * carry a one-time token (ADR 0008), and error messages and stacks can embed the request URL.
 * The `cause` chain follows, up to {@link MAX_CAUSES} deep (a failed fetch keeps its reason
 * there). Never throws, whatever was thrown.
 */
export function redactedErrorText(error: unknown): string {
  let text = describeOrFallback(error);
  try {
    let current = error;
    for (let depth = 0; depth < MAX_CAUSES && current instanceof Error; depth++) {
      const cause: unknown = current.cause;
      if (cause === undefined) break;
      text += `\nCaused by: ${describeOrFallback(cause)}`;
      current = cause;
    }
  } catch {
    // A `cause` getter or an `instanceof` check threw: keep the text collected so far.
  }
  return text.replace(/\?\S+/g, '?<redacted>');
}
