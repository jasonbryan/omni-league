import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCloudOff, lucideRotateCw } from '@ng-icons/lucide';
import { setServerErrorStatus } from '../core/server-error-status';

/**
 * The server-error view: the `server-error` state of design/mockups/60-organization-page.html,
 * approved through gate:ui-design in #73. A public page renders it inside its app shell, with no
 * sidebar, when its primary Convex query fails or times out (#60). After hydration the page's live
 * subscription replaces it as soon as a result arrives.
 *
 * On the server it sets status 503 and `Cache-Control: no-store` (`setServerErrorStatus`). It
 * never shows the error's message, which on the server is the real one (Convex adapter README,
 * "Server rendering").
 */
@Component({
  selector: 'app-server-error-view',
  imports: [NgIcon],
  providers: [provideIcons({ lucideCloudOff, lucideRotateCw })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16' },
  template: `
    <div
      class="mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center md:py-12 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
    >
      <span
        class="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"
      >
        <ng-icon name="lucideCloudOff" class="text-2xl" aria-hidden="true" />
      </span>
      <h1 class="mt-6 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
        This page is temporarily unavailable
      </h1>
      <p class="mt-3 text-balance text-muted-foreground">
        Omni League could not load it just now. It will appear here as soon as it loads, or you can
        try again.
      </p>
      <!-- A plain link, so it works before hydration. The classes are the not-found view's
           hlmBtn size="lg" plus mt-8 (server-error-view.spec.ts checks they match). -->
      <a
        [href]="retryHref()"
        data-slot="button"
        class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 bg-primary text-primary-foreground [a]:hover:bg-primary/90 h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 mt-8"
      >
        <ng-icon name="lucideRotateCw" data-icon="inline-start" aria-hidden="true" />
        Try again
      </a>
    </div>
  `,
})
export class ServerErrorView {
  /** The page's own path, built from the route (never the request URL, which can carry `?ott=`). */
  readonly retryHref = input.required<string>();

  constructor() {
    setServerErrorStatus();
    inject(Title).setTitle('Temporarily unavailable | Omni League');
  }
}
