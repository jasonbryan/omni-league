import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCompass, lucideSearch } from '@ng-icons/lucide';
import { setNotFoundStatus } from '../core/not-found-status';
import { OUTLINE_BUTTON_LARGE, PRIMARY_BUTTON_LARGE } from '../ui/button/button-classes';

/** It reads no data and nothing per visitor, so the server and the browser render the same DOM. */
@Component({
  selector: 'app-not-found-view',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideCompass, lucideSearch })],
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
        Check the address for typos, or find the league you are looking for.
      </p>
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <a routerLink="/leagues" data-slot="button" [class]="findClasses">
          <ng-icon name="lucideSearch" data-icon="inline-start" aria-hidden="true" />
          Find a league
        </a>
        <a routerLink="/" data-slot="button" [class]="homeClasses">Go to the home page</a>
      </div>
    </div>
  `,
})
export class NotFoundView {
  protected readonly findClasses = PRIMARY_BUTTON_LARGE;
  protected readonly homeClasses = OUTLINE_BUTTON_LARGE;

  constructor() {
    setNotFoundStatus();
    inject(Title).setTitle('Page not found | Omni League');
  }
}
