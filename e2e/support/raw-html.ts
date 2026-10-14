import type { APIRequestContext } from '@playwright/test';

export interface RawHtmlResponse {
  status: number;
  headers: Record<string, string>;
  html: string;
}

export async function fetchRawHtml(
  request: APIRequestContext,
  path: string,
): Promise<RawHtmlResponse> {
  const response = await request.get(path, { maxRedirects: 0 });
  return { status: response.status(), headers: response.headers(), html: await response.text() };
}
