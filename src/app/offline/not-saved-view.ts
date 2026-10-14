import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideRotateCw, lucideWifiOff } from '@ng-icons/lucide';

/**
 * The page's live subscription stays open, so the page replaces this view by itself when the connection returns.
 * It renders only in the browser (`online` is always true on the server), so it sets no status.
 */
@Component({
  selector: 'app-not-saved-view',
  imports: [NgIcon],
  providers: [provideIcons({ lucideRotateCw, lucideWifiOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16' },
  template: `
    <div
      class="mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center md:py-12 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
    >
      <span
        class="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"
      >
        <ng-icon name="lucideWifiOff" class="text-2xl" aria-hidden="true" />
      </span>
      <h1 class="mt-6 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
        This page isn't saved on this device
      </h1>
      <p class="mt-3 text-balance text-muted-foreground">
        Pages you open while connected stay available here offline. This one will appear as soon as
        you're connected, or you can try again.
      </p>
      <!-- A plain link to the same path, as the server-error view's. A full load also restarts a connection stuck in back-off. -->
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
export class NotSavedView {
  /** The page's own path, built from the route (never the current URL, which can carry `?ott=`). */
  readonly retryHref = input.required<string>();

  constructor() {
    inject(Title).setTitle('Not saved on this device | Omni League');
  }
}
