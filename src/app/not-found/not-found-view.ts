import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCompass, lucideHouse } from '@ng-icons/lucide';
import { setNotFoundStatus } from '../core/not-found-status';

/** It reads no data and nothing per visitor, so the server and the browser render the same DOM. */
@Component({
  selector: 'app-not-found-view',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideCompass, lucideHouse })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16' },
  template: `
    <div
      class="mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center md:py-12 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
    >
      <span
        class="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"
      >
        <ng-icon name="lucideCompass" class="text-2xl" aria-hidden="true" />
      </span>
      <h1 class="mt-6 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
        Page not found
      </h1>
      <p class="mt-3 text-balance text-muted-foreground">
        Check the address for typos, or start again from the home page.
      </p>
      <!-- The classes are those of hlmBtn size="lg" plus mt-8, so the view needs none of the helm button code. -->
      <a
        routerLink="/"
        data-slot="button"
        class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 bg-primary text-primary-foreground [a]:hover:bg-primary/90 h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 mt-8"
      >
        <ng-icon name="lucideHouse" data-icon="inline-start" aria-hidden="true" />
        Go to the home page
      </a>
    </div>
  `,
})
export class NotFoundView {
  constructor() {
    setNotFoundStatus();
    inject(Title).setTitle('Page not found | Omni League');
  }
}
