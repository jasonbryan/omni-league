import type { Request, Response } from 'express';

/**
 * Final Express error handler for the SSR server.
 *
 * Express 5's default handler prints `err.stack` (with absolute server paths) whenever
 * `NODE_ENV !== 'production'`, and `serve:ssr` does not set `NODE_ENV`. This handler always
 * answers with a generic plain-text body and logs the error on the server instead.
 *
 * - `URIError` (malformed percent-encoding in the request URL, thrown by the Angular engine):
 *   400 Bad Request.
 * - Anything else: 500 Internal Server Error.
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

  if (err instanceof URIError) {
    res.status(400).type('text/plain').send('Bad Request');
    return;
  }

  res.status(500).type('text/plain').send('Internal Server Error');
}
