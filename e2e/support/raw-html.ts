import type { APIRequestContext } from '@playwright/test';

export interface RawHtmlResponse {
  status: number;
  headers: Record<string, string>;
  html: string;
}

/**
 * Fetches a route the way a crawler or link-preview bot does: one HTTP request, no JavaScript
 * (ADR 0005 "Raw server HTML"). Use it for status, headers, and the HTML string; use a page with
 * `test.use({ javaScriptEnabled: false })` for locator assertions on the same HTML.
 */
export async function fetchRawHtml(
  request: APIRequestContext,
  path: string,
): Promise<RawHtmlResponse> {
  const response = await request.get(path, { maxRedirects: 0 });
  return { status: response.status(), headers: response.headers(), html: await response.text() };
}
