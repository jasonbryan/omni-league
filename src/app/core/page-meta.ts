import { DOCUMENT } from '@angular/common';
import { DestroyRef, REQUEST, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

/** Head tags of a public page (ADR 0006, "Meta tags"), from the page's query result. */
export interface PageMeta {
  /** The `<title>`. */
  readonly title: string;
  readonly ogTitle: string;
  readonly ogDescription: string;
  readonly ogType: 'website';
  /**
   * The canonical path, built from the query result (for example `/organizations/<slug>`), never
   * copied from the request URL: the query string can carry a one-time token (ADR 0008) and the
   * HTML is CDN-cacheable (PR #90).
   */
  readonly path: string;
}

const OG_PROPERTIES = ['og:title', 'og:description', 'og:type', 'og:url'] as const;

/**
 * Keeps the page's `<title>`, Open Graph tags, and `<link rel="canonical">` in step with `meta`,
 * during the server render and after every live update. `og:url` and the canonical are the request
 * origin plus `meta.path`: on the server the origin of `REQUEST`, whose host has passed the
 * `allowedHosts` check (ADR 0010 item 5); in the browser `location.origin`.
 *
 * When `meta` returns `null` (not found, failed, loading) the Open Graph tags and the canonical
 * are removed and the title is left to the view on screen. They are also removed when the page is
 * destroyed, so the next page never inherits them. Call it in an injection context.
 */
export function bindPageMeta(meta: () => PageMeta | null): void {
  const title = inject(Title);
  const tags = inject(Meta);
  const document = inject(DOCUMENT);
  const request = inject(REQUEST, { optional: true });
  const origin = request ? new URL(request.url).origin : document.location.origin;

  const clear = (): void => {
    for (const property of OG_PROPERTIES) tags.removeTag(`property="${property}"`);
    document.head.querySelector('link[rel="canonical"]')?.remove();
  };

  // Writes to the document head, which Angular does not render: a side effect outside Angular.
  effect(() => {
    const current = meta();
    if (!current) {
      clear();
      return;
    }
    const url = `${origin}${current.path}`;
    title.setTitle(current.title);
    const content: Record<(typeof OG_PROPERTIES)[number], string> = {
      'og:title': current.ogTitle,
      'og:description': current.ogDescription,
      'og:type': current.ogType,
      'og:url': url,
    };
    for (const property of OG_PROPERTIES) {
      tags.updateTag({ property, content: content[property] });
    }
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  });

  inject(DestroyRef).onDestroy(clear);
}
