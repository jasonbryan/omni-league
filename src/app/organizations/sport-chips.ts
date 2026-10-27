import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { organizationPath, sportViewPath, type PublicSport } from './organization-path';

const CHIP =
  'inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap md:h-9 pointer-coarse:min-h-11';
const OTHER_CHIP = `${CHIP} border-input hover:bg-muted`;
export function hasSportChoice(sports: readonly PublicSport[]): boolean {
  return sports.length > 1;
}

const CURRENT_CHIP = `${CHIP} border-foreground bg-foreground text-background`;

/**
 * Links, not buttons: the page filters before hydration, a filtered page has a URL to share, and Back returns to the previous filter.
 * An organization with fewer than two sports has nothing to choose between, so it shows none.
 */
@Component({
  selector: 'app-sport-chips',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasChoice()) {
      <div class="border-b border-border pb-4 md:pb-6">
        <nav aria-label="Sports" class="mx-auto w-full max-w-6xl px-4 md:px-8">
          <ul role="list" class="flex flex-wrap gap-2">
            @for (chip of chips(); track chip.href) {
              <li>
                <a
                  [routerLink]="chip.href"
                  [attr.aria-current]="chip.current ? 'page' : null"
                  [class]="chip.current ? currentChip : otherChip"
                  >{{ chip.name }}
                  <span class="tabular-nums" [class.text-muted-foreground]="!chip.current"
                    >{{ chip.count }}<span class="sr-only"> {{ chip.noun }}</span></span
                  ></a
                >
              </li>
            }
          </ul>
        </nav>
      </div>
    }
  `,
})
export class SportChips {
  readonly slug = input.required<string>();
  readonly sports = input.required<readonly PublicSport[]>();
  readonly allSportsLeagueCount = input.required<number>();
  readonly currentSegment = input<string | undefined>(undefined);

  protected readonly hasChoice = computed(() => hasSportChoice(this.sports()));
  protected readonly currentChip = CURRENT_CHIP;
  protected readonly otherChip = OTHER_CHIP;

  protected readonly chips = computed(() => [
    {
      name: 'All sports',
      href: organizationPath(this.slug()),
      count: this.allSportsLeagueCount(),
      noun: this.allSportsLeagueCount() === 1 ? 'league' : 'leagues',
      current: this.currentSegment() === undefined,
    },
    ...this.sports().map((sport) => ({
      name: sport.name,
      href: sportViewPath(this.slug(), sport.segment),
      count: sport.leagueCount,
      noun: sport.leagueCount === 1 ? 'league' : 'leagues',
      current: sport.segment === this.currentSegment(),
    })),
  ]);
}
