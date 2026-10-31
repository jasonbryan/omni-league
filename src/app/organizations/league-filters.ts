import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink, convertToParamMap, type Params } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSlidersHorizontal, lucideX } from '@ng-icons/lucide';
import {
  NO_DIVISION_FILTERS,
  hasDivisionFilters,
  type DivisionFilters,
} from '../../../convex/lib/leagueFilters';
import { PRIMARY_BUTTON_LARGE } from '../ui/button/button-classes';
import {
  CHIP_CHOICE_INPUT_CLASSES,
  CHIP_CHOICE_LABEL_CLASSES,
  CHIP_CHOICE_WRAPPER_CLASSES,
} from '../ui/chip/chip-classes';
import { filterPills, parseDivisionFilters, type FilterGroup } from './division-filters';
import { listPagesQuery } from './organization-path';

const PILL =
  'inline-flex h-11 items-center gap-1.5 rounded-full bg-secondary ps-3 pe-2 text-sm font-medium text-secondary-foreground hover:bg-muted md:h-9 pointer-coarse:min-h-11';

/**
 * A GET form, so the filters work before hydration and every filtered view has a URL. After hydration, Show leagues, a pill, and Clear all
 * are router navigations to the same URL a submit would load.
 */
@Component({
  selector: 'app-league-filters',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideSlidersHorizontal, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="border-b border-border pt-1 pb-4 md:pb-6">
      <div class="mx-auto w-full max-w-6xl px-4 md:px-8">
        <form
          method="get"
          [attr.action]="path()"
          role="search"
          aria-label="Filter leagues"
          (submit)="apply($event)"
        >
          @if (groups(); as groups) {
            @if (groups.length) {
              <details class="group/filters">
                <summary
                  class="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-input px-4 text-sm font-medium select-none hover:bg-muted md:h-9 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden"
                >
                  <ng-icon
                    name="lucideSlidersHorizontal"
                    class="text-base"
                    aria-hidden="true"
                  />Filters
                  @if (activeCount()) {
                    <span
                      class="flex size-6 items-center justify-center rounded-full bg-foreground text-xs tabular-nums text-background"
                      >{{ activeCount() }}</span
                    ><span class="sr-only"> active</span>
                  }
                </summary>
                <div class="mt-4 space-y-4">
                  @for (group of groups; track group.legend) {
                    <fieldset>
                      <legend class="text-sm font-medium">{{ group.legend }}</legend>
                      <div class="mt-3 flex flex-wrap gap-2">
                        @for (option of group.options; track option.value) {
                          <label [class]="wrapperClass"
                            ><input
                              type="checkbox"
                              [attr.name]="option.name"
                              [attr.value]="option.value"
                              [attr.checked]="option.checked ? '' : null"
                              [checked]="option.checked"
                              [class]="inputClass"
                            /><span [class]="chipClass">{{ option.label }}</span></label
                          >
                        }
                      </div>
                    </fieldset>
                  }
                  @if (locationsPage() > 1) {
                    <input type="hidden" name="locations" [attr.value]="locationsPage()" />
                  }
                  <button type="submit" data-slot="button" [class]="submitClass">
                    Show leagues
                  </button>
                </div>
              </details>
            }
          } @else {
            <span
              aria-hidden="true"
              class="block h-11 w-28 rounded-full bg-muted motion-safe:animate-pulse md:h-9"
            ></span>
          }
          <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p
              #countStatus
              role="status"
              tabindex="-1"
              class="text-sm text-muted-foreground focus:outline-none"
            >
              @if (count(); as count) {
                <span class="font-medium text-foreground">{{ count.shown }}</span
                >{{ count.of }} {{ count.noun }}
              }
            </p>
            @if (pills().length) {
              <ul role="list" aria-label="Active filters" class="flex flex-wrap gap-2">
                @for (pill of pills(); track pill.label) {
                  <li>
                    <a
                      [routerLink]="path()"
                      [queryParams]="pill.query"
                      [class]="pillClass"
                      (click)="focusCountNext($event)"
                      >{{ pill.label
                      }}<ng-icon name="lucideX" class="text-base" aria-hidden="true" /><span
                        class="sr-only"
                        >: remove the {{ pill.dimension }} filter</span
                      ></a
                    >
                  </li>
                }
              </ul>
              <a
                [routerLink]="path()"
                [queryParams]="clearQuery()"
                class="inline-flex items-center rounded-md text-sm font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                (click)="focusCountNext($event)"
                >Clear all</a
              >
            }
          </div>
        </form>
      </div>
    </div>
  `,
})
export class LeagueFilters {
  readonly path = input.required<string>();
  readonly sportView = input.required<boolean>();
  readonly filters = input<DivisionFilters>(NO_DIVISION_FILTERS);
  readonly groups = input<readonly FilterGroup[] | undefined>(undefined);
  readonly locationsPage = input(1);
  readonly total = input.required<number>();
  readonly matching = input<number | undefined>(undefined);

  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly countStatus = viewChild<ElementRef<HTMLElement>>('countStatus');
  private countFocusRequested = false;

  protected readonly wrapperClass = CHIP_CHOICE_WRAPPER_CLASSES;
  protected readonly inputClass = CHIP_CHOICE_INPUT_CLASSES;
  protected readonly chipClass = CHIP_CHOICE_LABEL_CLASSES;
  protected readonly submitClass = PRIMARY_BUTTON_LARGE;
  protected readonly pillClass = PILL;

  private readonly filtered = computed(() => hasDivisionFilters(this.filters()));

  protected readonly activeCount = computed(() => filterPills(this.filters()).length);

  /** Filtered, it waits for the filtered total rather than show the count of the previous filters. */
  protected readonly count = computed(() => {
    const total = this.total();
    const matching = this.matching();
    if (this.filtered() && matching === undefined) return undefined;
    return {
      shown: matching ?? total,
      of: matching === undefined ? '' : ` of ${total}`,
      noun: total === 1 ? 'league' : 'leagues',
    };
  });

  private queryFor(filters: DivisionFilters): Params {
    return listPagesQuery(
      { leagues: 1, locations: this.locationsPage() },
      this.sportView(),
      filters,
    );
  }

  protected readonly pills = computed(() =>
    filterPills(this.filters()).map((pill) => ({ ...pill, query: this.queryFor(pill.without) })),
  );

  readonly clearQuery = computed(() => this.queryFor(NO_DIVISION_FILTERS));

  constructor() {
    effect(() => {
      this.filters();
      untracked(() => {
        if (!this.countFocusRequested) return;
        this.countFocusRequested = false;
        afterNextRender(() => this.countStatus()?.nativeElement.focus(), {
          injector: this.injector,
        });
      });
    });
  }

  /** The pressed pill or Clear all leaves the page with its filter, so focus goes to the count, which announces the result. */
  focusCountNext(event: MouseEvent): void {
    const plain =
      event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    if (plain) this.countFocusRequested = true;
  }

  protected apply(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const params: Record<string, string[]> = {};
    for (const [name, value] of new FormData(form)) {
      if (typeof value === 'string') (params[name] ??= []).push(value);
    }
    const filters = parseDivisionFilters(convertToParamMap(params), undefined);
    void this.router.navigate([this.path()], { queryParams: this.queryFor(filters) });
  }
}
