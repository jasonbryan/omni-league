import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMapPin, lucideMapPinOff, lucideTrophy, lucideVolleyball } from '@ng-icons/lucide';
import { SavedCopyNote } from '../offline/saved-copy-note';
import type { PublicOrganizationPage } from './organization-path';
import { publicLeaguePath } from './public-league/public-league-path';

@Component({
  selector: 'app-organization-overview',
  imports: [NgIcon, RouterLink, SavedCopyNote],
  providers: [provideIcons({ lucideMapPin, lucideMapPinOff, lucideTrophy, lucideVolleyball })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    <p class="text-sm font-medium text-muted-foreground">Organization</p>
    <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
      {{ page().name }}
    </h1>
    @if (savedAt(); as savedAt) {
      <app-saved-copy-note [savedAt]="savedAt" />
    }
    <dl class="mt-6 grid grid-cols-3 gap-3 md:gap-4">
      @for (tile of tiles(); track tile.label) {
        <div
          class="rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 px-3 py-3 md:px-4 md:py-4"
        >
          <dt class="flex items-center gap-2 text-xs font-medium text-muted-foreground md:text-sm">
            <span
              class="hidden size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground md:flex"
              ><ng-icon [name]="tile.icon" class="text-base" aria-hidden="true" /></span
            >{{ tile.label }}
          </dt>
          <dd class="mt-1 text-2xl font-semibold tabular-nums md:mt-2">{{ tile.count }}</dd>
        </div>
      }
    </dl>
    <div class="mt-4 grid items-start gap-4 md:mt-6 md:gap-6 lg:grid-cols-3">
      <section
        aria-labelledby="leagues-heading"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 lg:col-span-2"
      >
        <div class="border-b border-border px-4 py-3 md:px-5">
          <h2 id="leagues-heading" class="font-semibold">Leagues</h2>
        </div>
        @if (leagues().length) {
          <ul role="list" class="divide-y divide-border">
            @for (league of leagues(); track league.id) {
              <li
                [id]="league.id"
                class="flex items-start justify-between gap-3 px-4 py-3.5 md:px-5"
              >
                <div class="min-w-0">
                  <h3 class="font-medium">
                    <a
                      [routerLink]="league.href"
                      class="underline underline-offset-4 hover:text-primary"
                      >{{ league.name }}</a
                    >
                  </h3>
                  @if (league.locations) {
                    <p class="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideMapPin"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      /><span
                        ><span class="sr-only">{{ league.locationsLabel }}</span
                        >{{ league.locations }}</span
                      >
                    </p>
                  }
                </div>
                <!-- The mockup's badge: helm's hlmBadge variant="secondary" classes plus mt-0.5. -->
                <span
                  data-slot="badge"
                  data-variant="secondary"
                  class="group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)] bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80 mt-0.5"
                  >{{ league.sportName }}</span
                >
              </li>
            }
          </ul>
        } @else {
          <div class="flex flex-col items-center px-6 py-10 text-center">
            <span
              class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              ><ng-icon name="lucideTrophy" class="text-xl" aria-hidden="true"
            /></span>
            <p class="mt-4 font-medium">No leagues yet</p>
            <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
              Leagues this organization runs will be listed here.
            </p>
          </div>
        }
      </section>
      <section
        id="locations"
        aria-labelledby="locations-heading"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
      >
        <div class="border-b border-border px-4 py-3 md:px-5">
          <h2 id="locations-heading" class="font-semibold">Locations</h2>
        </div>
        @if (locations().length) {
          <ul role="list" class="divide-y divide-border">
            @for (location of locations(); track location.id) {
              <li [id]="location.id" class="flex gap-3 px-4 py-3.5 md:px-5">
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                  ><ng-icon name="lucideMapPin" class="text-lg" aria-hidden="true"
                /></span>
                <div class="min-w-0">
                  <h3 class="font-medium">{{ location.name }}</h3>
                  <p class="mt-0.5 text-sm text-muted-foreground">{{ location.address }}</p>
                </div>
              </li>
            }
          </ul>
        } @else {
          <div class="flex flex-col items-center px-6 py-10 text-center">
            <span
              class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              ><ng-icon name="lucideMapPinOff" class="text-xl" aria-hidden="true"
            /></span>
            <p class="mt-4 font-medium">No locations yet</p>
            <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
              Places where this organization plays will be listed here.
            </p>
          </div>
        }
      </section>
    </div>
  `,
})
export class OrganizationOverview {
  readonly page = input.required<PublicOrganizationPage>();
  /** When the saved copy shown was saved; set only while offline (`OrganizationPage`). */
  readonly savedAt = input<number | undefined>(undefined);

  /**
   * The organization's league, location, and sport totals (#73 decision 4), from
   * `getPublicPage`: never the number of rows shown, which is at most 5 per list (#100).
   */
  protected readonly tiles = computed(() => {
    const { leagueCount, locationCount, sportCount } = this.page();
    return [
      { label: 'Leagues', icon: 'lucideTrophy', count: leagueCount },
      { label: 'Locations', icon: 'lucideMapPin', count: locationCount },
      { label: 'Sports', icon: 'lucideVolleyball', count: sportCount },
    ];
  });

  protected readonly leagues = computed(() =>
    this.page().leagues.map((league, i) => ({
      id: `league-${i + 1}`,
      name: league.name,
      href: publicLeaguePath(this.page().slug, league.slug),
      sportName: league.sportName,
      locationsLabel: league.locationNames.length === 1 ? 'Location: ' : 'Locations: ',
      locations: league.locationNames.join(', '),
    })),
  );

  protected readonly locations = computed(() =>
    this.page().locations.map((location, i) => ({
      id: `location-${i + 1}`,
      name: location.name,
      address: location.address,
    })),
  );
}
