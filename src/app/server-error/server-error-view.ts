import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCloudOff, lucideRotateCw } from '@ng-icons/lucide';
import { setServerErrorStatus } from '../core/server-error-status';
import { PRIMARY_BUTTON } from '../ui/button/button-classes';

/** It never shows the error's message, which on the server is the real one. */
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
      <!-- A plain link, so it works before hydration. -->
      <a [href]="retryHref()" data-slot="button" [class]="retryClasses">
        <ng-icon name="lucideRotateCw" data-icon="inline-start" aria-hidden="true" />
        Try again
      </a>
    </div>
  `,
})
export class ServerErrorView {
  /** The page's own path, built from the route (never the request URL, which can carry `?ott=`). */
  readonly retryHref = input.required<string>();

  protected readonly retryClasses = `${PRIMARY_BUTTON} mt-8`;

  constructor() {
    setServerErrorStatus();
    inject(Title).setTitle('Temporarily unavailable | Omni League');
  }
}
