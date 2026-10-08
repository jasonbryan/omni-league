import type { Request, Response } from 'express';

/**
 * Final Express error handler for the SSR server.
 *
 * Express 5's default handler prints `err.stack` (with absolute server paths) whenever
 * `NODE_ENV !== 'production'`, and `serve:ssr` does not set `NODE_ENV`. This handler always
 * answers with a generic plain-text body and logs the error on the server instead.
 *
 * - `URIError` when the request path itself has malformed percent-encoding (thrown by the Angular
 *   engine): 400 Bad Request.
 * - Anything else, including a `URIError` from app code decoding a well-formed path, a malformed
 *   query string, or data: 500 Internal Server Error.
 * - If headers were already sent, Express must close the connection, so the error is passed on.
 */
export function serverErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
): void {
  console.error(`Error handling ${req.method} ${req.originalUrl}:`, err);

  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof URIError && isMalformedPath(req.originalUrl)) {
    res.status(400).type('text/plain').send('Bad Request');
    return;
  }

  res.status(500).type('text/plain').send('Internal Server Error');
}

/**
 * True when the request path's percent-encoding cannot be decoded (a client error). Only the path
 * counts: the engine does not decode the query string, so a malformed query with a `URIError` means
 * app code threw, which is a 500.
 */
function isMalformedPath(url: string): boolean {
  const queryStart = url.indexOf('?');
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  try {
    decodeURIComponent(path);
    return false;
  } catch {
    return true;
  }
}
