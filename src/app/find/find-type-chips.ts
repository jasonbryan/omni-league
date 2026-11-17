import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import {
  PROGRAM_TYPES,
  SEARCHABLE_PROGRAM_TYPES,
  type ProgramType,
} from '../../../convex/lib/programs';
import type { Sport } from '../../../convex/lib/sports';
import { chipLinkClasses } from '../ui/chip/chip-classes';
import { FIND_PATH, findQuery } from './find-path';
import { PROGRAM_TYPE_WORDS } from './program-type';

/**
 * Links, as the sport chips are: the page filters before hydration, a chosen type has a URL to share, and Back returns to the previous one.
 * A link keeps the search, the sport, and the filters, so a type never loses what the visitor already chose.
 */
@Component({
  selector: 'app-find-type-chips',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  // The hidden list shares the cell with the chips and holds every chip a search can offer, so the row is as tall as it wraps on a narrow screen before the answer arrives and nothing below it moves.
  template: `
    <nav aria-label="Program type" class="mt-4 grid">
      <ul role="list" class="col-start-1 row-start-1 flex flex-wrap gap-2 self-start">
        @for (chip of chips(); track chip.name) {
          <li>
            <a
              [routerLink]="path"
              [queryParams]="chip.query"
              [attr.aria-current]="chip.current ? 'page' : null"
              [class]="chip.classes"
              >{{ chip.name }}</a
            >
          </li>
        }
      </ul>
      <ul
        aria-hidden="true"
        data-chip-sizer
        class="invisible col-start-1 row-start-1 flex flex-wrap gap-2"
      >
        @for (name of sizerNames; track name) {
          <li>
            <span [class]="sizerClasses">{{ name }}</span>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class FindTypeChips {
  /** The parsed search; empty for none. */
  readonly query = input.required<string>();
  readonly type = input<ProgramType | undefined>(undefined);
  readonly sport = input<Sport | undefined>(undefined);
  readonly filters = input<DivisionFilters>(NO_DIVISION_FILTERS);
  /** The types with a match; `undefined` until the page knows, when only All and the current type show, so the row keeps its height as the rest arrive. */
  readonly offered = input<readonly ProgramType[] | undefined>(undefined);

  protected readonly path = FIND_PATH;
  protected readonly sizerNames = [
    'All',
    ...SEARCHABLE_PROGRAM_TYPES.map((type) => PROGRAM_TYPE_WORDS[type].chip),
  ];
  protected readonly sizerClasses = chipLinkClasses(false);

  protected readonly chips = computed(() => {
    const offered = this.offered() ?? [];
    const shown = PROGRAM_TYPES.filter((type) => offered.includes(type) || type === this.type());
    const choices: { name: string; type: ProgramType | undefined }[] = [
      { name: 'All', type: undefined },
      ...shown.map((type) => ({ name: PROGRAM_TYPE_WORDS[type].chip, type })),
    ];
    return choices.map(({ name, type }) => {
      const current = type === this.type();
      // With no search and no sport, All is the organizations list, which no filter applies to.
      const scoped =
        type === undefined && this.sport() === undefined && this.query() === ''
          ? NO_DIVISION_FILTERS
          : this.filters();
      return {
        name,
        current,
        classes: chipLinkClasses(current),
        query: findQuery(this.query(), { type, sport: this.sport(), filters: scoped }),
      };
    });
  });
}
