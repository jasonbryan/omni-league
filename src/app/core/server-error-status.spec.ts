import { PlatformLocation } from '@angular/common';
import { REQUEST, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { setServerErrorStatus } from './server-error-status';

function run(responseInit: ResponseInit | null, request?: string, location?: string): void {
  const { pathname, search, hash } = new URL(location ?? request ?? '/', 'http://localhost');
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformLocation, useValue: { pathname, search, hash } },
      ...(responseInit ? [{ provide: RESPONSE_INIT, useValue: responseInit }] : []),
      ...(request
        ? [{ provide: REQUEST, useValue: new Request(`http://localhost${request}`) }]
        : []),
    ],
  });
  TestBed.runInInjectionContext(() => setServerErrorStatus());
}

describe('setServerErrorStatus', () => {
  it('does nothing without RESPONSE_INIT (browser, prerender)', () => {
    expect(() => run(null, '/organizations/x')).not.toThrow();
  });

  it("sets 503 and replaces the route's Cache-Control with no-store, keeping other headers", () => {
    const responseInit: ResponseInit = {
      headers: new Headers({
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
      }),
    };
    run(responseInit, '/organizations/x');
    expect(responseInit.status).toBe(503);
    const headers = new Headers(responseInit.headers);
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
  });

  it('accepts headers given as a plain object', () => {
    const responseInit: ResponseInit = { headers: { 'Cache-Control': 'public, s-maxage=60' } };
    run(responseInit, '/organizations/x');
    expect(new Headers(responseInit.headers).get('Cache-Control')).toBe('no-store');
  });

  // As with the 404 (PR #90): when the engine will redirect a URL the router normalized, a 5xx
  // status would go out with the Location. The redirect is no-store already (src/server.ts).
  it('leaves the response alone when the router normalized the URL', () => {
    const responseInit: ResponseInit = { headers: { 'Cache-Control': 'public, s-maxage=60' } };
    run(responseInit, '/organizations/x//', '/organizations/x/');
    expect(responseInit.status).toBeUndefined();
    expect(new Headers(responseInit.headers).get('Cache-Control')).toBe('public, s-maxage=60');
  });
});
