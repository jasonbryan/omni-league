import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

/** Loads a URL as a full page load (`location.assign`); a token so unit tests can observe it. */
export const LOAD_PAGE = new InjectionToken<(url: string) => void>('LOAD_PAGE', {
  factory: () => {
    const document = inject(DOCUMENT);
    return (url) => {
      document.location.assign(url);
    };
  },
});

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function isPlainClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * The server-rendered `href` of a link to a row on the current page is query-free, so the browser's own handling of a click would load `/path#row` and drop the visitor's query string (`?utm_*`, `?ott=`).
 * A link to the path the router is on is therefore followed to the current path, the current query string, and the link's fragment.
 * That is a router navigation, so `router.url` stays right (the skip link reads it) and Back returns to the URL before the click, as a native fragment link does.
 */
@Injectable({ providedIn: 'root' })
export class FollowLink {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly loadPage = inject(LOAD_PAGE);

  clicked(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const link = event.currentTarget as HTMLAnchorElement | null;
    if (!link?.href) return;
    const url = new URL(link.href);
    if (!this.isCurrentPath(url)) return;
    event.preventDefault();
    this.follow(url.href);
  }

  follow(href: string): void {
    const url = new URL(href);
    if (url.origin !== this.document.location.origin) {
      this.loadPage(url.href);
      return;
    }
    const fragment = decodeFragment(url.hash.slice(1));
    // A URL the client router cannot reach loads as a full page, as the link itself would have.
    // The `**` route matches every primary path, but the router still rejects a chunk that fails to load and an auxiliary outlet no route matches (`/(//evil.com)`).
    this.router.navigateByUrl(this.target(url)).then(
      () => {
        if (fragment) this.document.getElementById(fragment)?.scrollIntoView();
      },
      () => {
        this.loadPage(url.href);
      },
    );
  }

  private isCurrentPath(url: URL): boolean {
    return (
      url.origin === this.document.location.origin &&
      this.pathOf(this.router.parseUrl(this.router.url)) ===
        this.pathOf(this.router.parseUrl(url.pathname + url.search))
    );
  }

  private target(url: URL): string {
    const here = this.router.parseUrl(this.router.url);
    const there = this.router.parseUrl(url.pathname + url.search + url.hash);
    if (this.pathOf(here) !== this.pathOf(there)) return url.pathname + url.search + url.hash;
    here.fragment = there.fragment;
    return this.router.serializeUrl(here);
  }

  private pathOf(tree: UrlTree): string {
    return this.router.serializeUrl(new UrlTree(tree.root, {}, null));
  }
}
