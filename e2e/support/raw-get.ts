import type { IncomingHttpHeaders } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { baseURL } from './env';

export interface RawGetResponse {
  status: number;
  headers: IncomingHttpHeaders;
  location: string | undefined;
  body: string;
}

/**
 * One GET with the request target exactly as given, no redirect followed. Playwright's request API
 * and `fetch` resolve `//evil.com/x` as a protocol-relative URL (another host), so they cannot
 * send it.
 */
export function rawGet(path: string): Promise<RawGetResponse> {
  const base = new URL(baseURL);
  const send = base.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      { hostname: base.hostname, port: base.port || undefined, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
