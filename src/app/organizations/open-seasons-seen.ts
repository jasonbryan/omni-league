import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { hasDivisionFilters, type DivisionFilters } from '../../../convex/lib/leagueFilters';

export const UNSEEN_OPEN_SEASON_COUNT = 2;

export interface OpenSeasonsView {
  readonly slug: string;
  /** A name, not a key, because an open season's row carries only the name. */
  readonly sport: string | undefined;
  readonly filters: DivisionFilters;
}

const viewKey = ({ slug, sport, filters }: OpenSeasonsView): string =>
  JSON.stringify([
    slug,
    sport ?? null,
    filters.gender,
    filters.playersPerSide,
    filters.level,
    filters.ageGroup,
  ]);

/** Kept in memory, never saved, because a saved copy would outlive the seasons it counts. Only the browser records, because a server render shows no skeleton. */
@Injectable({ providedIn: 'root' })
export class OpenSeasonsSeen {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly sportNamesByView = new Map<string, readonly string[]>();
  private readonly latestCountByOrganization = new Map<string, number>();

  record(view: OpenSeasonsView, sportNames: readonly string[]): void {
    if (!this.browser) return;
    this.sportNamesByView.set(viewKey(view), sportNames);
    this.latestCountByOrganization.set(view.slug, sportNames.length);
  }

  expectedCount(view: OpenSeasonsView): number {
    const own = this.sportNamesByView.get(viewKey(view));
    if (own) return own.length;
    return (
      this.countInAllSports(view) ??
      this.latestCountByOrganization.get(view.slug) ??
      UNSEEN_OPEN_SEASON_COUNT
    );
  }

  private countInAllSports({ slug, sport, filters }: OpenSeasonsView): number | undefined {
    if (sport === undefined || hasDivisionFilters(filters)) return undefined;
    const names = this.sportNamesByView.get(viewKey({ slug, sport: undefined, filters }));
    return names?.filter((name) => name === sport).length;
  }
}
