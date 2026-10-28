import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSearch } from '@ng-icons/lucide';

const FIND_PATH = '/leagues';

/**
 * A field from 768px and a link to the search page below it. The form is a plain GET form, so a search works before hydration;
 * after it, the router carries the words to the search page, which parses them.
 */
@Component({
  selector: 'app-top-bar-find',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideSearch })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <form
      role="search"
      aria-label="Find a league"
      [action]="action"
      method="get"
      class="hidden w-full md:col-start-2 md:block"
      (submit)="submit($event, field.value)"
    >
      <label for="top-find" class="sr-only">Find a league</label>
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
          placeholder="Find a league"
          autocomplete="off"
          class="h-10 w-full rounded-full border border-input bg-card ps-10 pe-4 text-sm placeholder:text-muted-foreground pointer-coarse:h-11"
        />
      </div>
    </form>
    <a
      routerLink="/leagues"
      class="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted md:hidden"
    >
      <ng-icon name="lucideSearch" class="text-xl" aria-hidden="true" />
      <span class="sr-only">Find a league</span>
    </a>
  `,
})
export class TopBarFind {
  private readonly router = inject(Router);

  protected readonly action = FIND_PATH;

  protected submit(event: Event, value: string): void {
    event.preventDefault();
    const q = value.trim();
    void this.router.navigate([FIND_PATH], { queryParams: q === '' ? {} : { q } });
  }
}
