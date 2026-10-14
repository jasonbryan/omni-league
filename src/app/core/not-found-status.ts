import { APP_BASE_HREF, PlatformLocation } from '@angular/common';
import { REQUEST, RESPONSE_INIT, inject } from '@angular/core';
import { UrlSerializer } from '@angular/router';

/**
 * The status stays unset when `@angular/ssr` will answer with a redirect (the router normalizes some URLs, `/x//` to `/x/` and `/x/(y)` to `/x`): the engine then sends a 302 and the target URL renders the not-found page itself.
 * A 404 there would reach the browser with a `Location` and an empty body, or throw `Invalid redirect status code: 404` in a development build. `src/server.ts` makes every redirect `no-store` and turns a response with a `Location` and a non-3xx status into a 302.
 */
export function setNotFoundStatus(): void {
  const responseInit = inject(RESPONSE_INIT, { optional: true });
  if (!responseInit) return;
  if (!willRedirect()) responseInit.status = 404;
}

/**
 * It mirrors `renderAngular` and `constructSerializedUrl` in `@angular/ssr@22.2` (`fesm2022/ssr.mjs`);
 * `e2e/not-found.spec.ts` fails if the two drift apart.
 */
export function willRedirect(): boolean {
  const request = inject(REQUEST, { optional: true });
  if (!request) return false;
  const serializer = inject(UrlSerializer);
  const location = inject(PlatformLocation);
  const prefix =
    inject(APP_BASE_HREF, { optional: true }) ?? request.headers.get('X-Forwarded-Prefix');
  const requested = new URL(request.url);
  if (requested.pathname.endsWith('/index.html')) {
    requested.pathname = requested.pathname.slice(0, -'index.html'.length - 1);
  }
  return (
    serializedUrl(serializer, requested, prefix) !== serializedUrl(serializer, location, prefix)
  );
}

type UrlParts = Pick<URL, 'pathname' | 'search' | 'hash'>;

/** `constructSerializedUrl`, with `Router.parseUrl`'s fallback to `/` but not its warning. */
function serializedUrl(serializer: UrlSerializer, url: UrlParts, prefix: string | null): string {
  const { pathname, search, hash } = url;
  const path =
    prefix && !withTrailingSlash(pathname).startsWith(withTrailingSlash(prefix))
      ? joinUrlParts(prefix, pathname)
      : withoutTrailingSlash(pathname);
  let tree;
  try {
    tree = serializer.parse(path + search + hash);
  } catch {
    tree = serializer.parse('/');
  }
  return serializer.serialize(tree);
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function withoutTrailingSlash(url: string): string {
  return url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
}

function joinUrlParts(...parts: string[]): string {
  const inner = parts.map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${inner.join('/')}`;
}
