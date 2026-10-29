import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideRotateCw, lucideWifiOff } from '@ng-icons/lucide';
import { PRIMARY_BUTTON } from '../ui/button/button-classes';

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
      <a [href]="retryHref()" data-slot="button" [class]="retryClasses">
        <ng-icon name="lucideRotateCw" data-icon="inline-start" aria-hidden="true" />
        Try again
      </a>
    </div>
  `,
})
export class NotSavedView {
  /** The page's own path, built from the route (never the current URL, which can carry `?ott=`). */
  readonly retryHref = input.required<string>();

  protected readonly retryClasses = `${PRIMARY_BUTTON} mt-8`;

  constructor() {
    inject(Title).setTitle('Not saved on this device | Omni League');
  }
}
