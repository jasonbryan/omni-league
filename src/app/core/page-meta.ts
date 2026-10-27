import { DOCUMENT } from '@angular/common';
import { DestroyRef, REQUEST, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

export interface PageMeta {
  readonly title: string;
  readonly ogTitle: string;
  readonly ogDescription: string;
  readonly ogType: 'website';
  /** Built from the query result, never copied from the request URL: the query string can carry a one-time token and the HTML is CDN-cacheable. */
  readonly path: string;
}

const OG_PROPERTIES = ['og:title', 'og:description', 'og:type', 'og:url'] as const;

/** `og:url` and the canonical are the request origin plus `meta.path`: on the server the origin of `REQUEST`, whose host has passed the `allowedHosts` check; in the browser `location.origin`. */
export function bindPageMeta(meta: () => PageMeta | null): void {
  const title = inject(Title);
  const tags = inject(Meta);
  const document = inject(DOCUMENT);
  const request = inject(REQUEST, { optional: true });
  const origin = request ? new URL(request.url).origin : document.location.origin;

  const clear = (): void => {
    for (const property of OG_PROPERTIES) tags.removeTag(`property="${property}"`);
    tags.removeTag('name="description"');
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
    tags.updateTag({ name: 'description', content: current.ogDescription });
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
