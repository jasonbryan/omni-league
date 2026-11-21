import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSearch } from '@ng-icons/lucide';
import { isReplayedEvent } from '../core/replayed-event';

const FIND_PATH = '/programs';

/** A plain GET form, so a search works before hydration. */
@Component({
  selector: 'app-top-bar-find',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideSearch })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <form
      role="search"
      aria-label="Find a program"
      [action]="action"
      method="get"
      class="hidden w-full md:col-start-2 md:block"
      (submit)="submit($event, field.value)"
    >
      <label for="top-find" class="sr-only">Find a program</label>
      <div class="relative">
        <ng-icon
          name="lucideSearch"
          class="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-base text-muted-foreground"
          aria-hidden="true"
        />
        <input
          #field
          id="top-find"
          name="q"
          type="search"
          placeholder="Find a program"
          autocomplete="off"
          class="h-10 w-full rounded-full border border-input bg-card ps-10 pe-4 text-sm placeholder:text-muted-foreground pointer-coarse:h-11"
        />
      </div>
    </form>
    <a
      routerLink="/programs"
      class="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted md:hidden"
    >
      <ng-icon name="lucideSearch" class="text-xl" aria-hidden="true" />
      <span class="sr-only">Find a program</span>
    </a>
  `,
})
export class TopBarFind {
  private readonly router = inject(Router);

  protected readonly action = FIND_PATH;

  protected submit(event: Event, value: string): void {
    if (isReplayedEvent(event)) return;
    event.preventDefault();
    const q = value.trim();
    void this.router.navigate([FIND_PATH], { queryParams: q === '' ? {} : { q } });
  }
}
