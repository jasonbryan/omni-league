import { APP_BASE_HREF, PlatformLocation } from '@angular/common';
import { REQUEST, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { setNotFoundStatus } from './not-found-status';

// `@angular/ssr` redirects when the request URL and the URL the router left in `PlatformLocation` differ once serialized.
// The status must then stay unset, so the engine sends a 302 rather than a 404 with a Location (production) or a throw (development).

interface Setup {
  responseInit?: ResponseInit;
  request?: string;
  headers?: Record<string, string>;
  location?: string;
  baseHref?: string;
}

function run({ responseInit, request, headers, location, baseHref }: Setup): void {
  const { pathname, search, hash } = new URL(location ?? '/', 'http://localhost');
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformLocation, useValue: { pathname, search, hash } },
      ...(responseInit ? [{ provide: RESPONSE_INIT, useValue: responseInit }] : []),
      ...(request
        ? [{ provide: REQUEST, useValue: new Request(`http://localhost${request}`, { headers }) }]
        : []),
      ...(baseHref ? [{ provide: APP_BASE_HREF, useValue: baseHref }] : []),
    ],
  });
  TestBed.runInInjectionContext(() => setNotFoundStatus());
}

describe('setNotFoundStatus', () => {
  it('does nothing without RESPONSE_INIT (browser, prerender)', () => {
    expect(() => run({ request: '/x//', location: '/x/' })).not.toThrow();
  });

  it('sets 404 when there is no REQUEST', () => {
    const responseInit: ResponseInit = {};
    run({ responseInit });
    expect(responseInit.status).toBe(404);
  });

  it.each([
    ['/x', '/x'],
    ['/x/', '/x'],
    ['/', '/'],
    ['/x?token=A/B', '/x?token=A%2FB'],
    ['/x?b=2&a=1', '/x?b=2&a=1'],
    ['/foo(bar)', '/foo'],
    ['/foo%28bar%29', '/foo%28bar%29'],
    ['/caf%C3%A9', '/caf%C3%A9'],
    ['/x;a=b/y', '/x;a=b/y'],
    ['/x/index.html', '/x'],
    ['/organizations/x/', '/organizations/x'],
  ])('sets 404 when the router keeps %s (location %s)', (request, location) => {
    const responseInit: ResponseInit = {};
    run({ responseInit, request, location });
    expect(responseInit.status).toBe(404);
  });

  it.each([
    ['/x//', '/x/'],
    ['/x//?token=A/B', '/x/?token=A%2FB'],
    ['/organizations/x//', '/organizations/x/'],
    ['/organizations/(x)', '/organizations'],
    ['/x/(y)/', '/x'],
    ['/x/)', '/x/'],
    ['/app/x//', '/app/x/'],
  ])('leaves the status unset when the router normalizes %s to %s', (request, location) => {
    const responseInit: ResponseInit = {};
    run({ responseInit, request, location });
    expect(responseInit.status).toBeUndefined();
  });

  it('leaves a redirect status the route set', () => {
    const responseInit: ResponseInit = { status: 301 };
    run({ responseInit, request: '/x//', location: '/x/' });
    expect(responseInit.status).toBe(301);
  });

  it.each([
    ['X-Forwarded-Prefix', { headers: { 'X-Forwarded-Prefix': '/base' } }],
    ['APP_BASE_HREF', { baseHref: '/base' }],
  ] as const)('compares the URLs under the %s prefix', (_, prefix) => {
    const kept: ResponseInit = {};
    run({ ...prefix, responseInit: kept, request: '/base/x', location: '/base/x' });
    expect(kept.status).toBe(404);

    TestBed.resetTestingModule();
    const normalized: ResponseInit = {};
    run({ ...prefix, responseInit: normalized, request: '/base/x//', location: '/base/x/' });
    expect(normalized.status).toBeUndefined();
  });
});
