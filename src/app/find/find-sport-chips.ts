import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  NO_DIVISION_FILTERS,
  filtersInScope,
  type DivisionFilters,
} from '../../../convex/lib/leagueFilters';
import { SPORT_NAMES, type Sport } from '../../../convex/lib/sports';
import { chipLinkClasses } from '../ui/chip/chip-classes';
import { findQuery } from './find-path';

const SPORTS = Object.keys(SPORT_NAMES) as Sport[];

/**
 * Links, not buttons: the page filters before hydration, a chosen sport has a URL to share, and Back returns to the previous one.
 * A link keeps the search and the filters that mean something in its sport, so a format or level of another sport never reaches it.
 */
@Component({
  selector: 'app-find-sport-chips',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <nav aria-label="Sport" class="mt-4">
      <ul role="list" class="flex flex-wrap gap-2">
        @for (chip of chips(); track chip.name) {
          <li>
            <a
              routerLink="/leagues"
              [queryParams]="chip.query"
              [attr.aria-current]="chip.current ? 'page' : null"
              [class]="chip.classes"
              >{{ chip.name }}</a
            >
          </li>
        }
      </ul>
    </nav>
  `,
})
export class FindSportChips {
  /** The parsed search; empty for none. */
  readonly query = input.required<string>();
  readonly sport = input<Sport | undefined>(undefined);
  readonly filters = input<DivisionFilters>(NO_DIVISION_FILTERS);

  protected readonly chips = computed(() => {
    const choices: { name: string; sport: Sport | undefined }[] = [
      { name: 'All sports', sport: undefined },
      ...SPORTS.map((sport) => ({ name: SPORT_NAMES[sport], sport })),
    ];
    return choices.map(({ name, sport }) => {
      const current = sport === this.sport();
      return {
        name,
        current,
        classes: chipLinkClasses(current),
        query: findQuery(this.query(), { sport, filters: filtersInScope(this.filters(), sport) }),
      };
    });
  });
}
