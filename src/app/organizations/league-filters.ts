import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  InjectionToken,
  Injector,
  afterNextRender,
  computed,
  createComponent,
  effect,
  inject,
  input,
  inputBinding,
  signal,
  untracked,
  viewChild,
  type ComponentRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router, RouterLink, type Params } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideSlidersHorizontal, lucideX } from '@ng-icons/lucide';
import { filter } from 'rxjs';
import {
  NO_DIVISION_FILTERS,
  hasDivisionFilters,
  type DivisionFilters,
} from '../../../convex/lib/leagueFilters';
import type { Sport, SportCounts } from '../../../convex/lib/sports';
import { PRIMARY_BUTTON_LARGE } from '../ui/button/button-classes';
import {
  CHIP_CHOICE_INPUT_CLASSES,
  CHIP_CHOICE_LABEL_CLASSES,
  CHIP_CHOICE_WRAPPER_CLASSES,
} from '../ui/chip/chip-classes';
import {
  filterPills,
  filterPopoverId,
  filtersFromForm,
  type FilterGroup,
  type LeagueFacet,
} from './division-filters';
import type { FilterOverlay, LeagueFilterOverlays } from './league-filter-overlays';
import { listPagesQuery } from './organization-path';

/** Imports the filter sheet and popovers. A token so that tests can hold the import back. */
export const LOAD_FILTER_OVERLAYS = new InjectionToken<
  () => Promise<typeof import('./league-filter-overlays')>
>('LOAD_FILTER_OVERLAYS', { factory: () => () => import('./league-filter-overlays') });

const FILTERS_BUTTON =
  'inline-flex h-11 items-center gap-2 rounded-full border border-input px-4 text-sm font-medium hover:bg-muted aria-expanded:bg-muted md:hidden pointer-coarse:min-h-11';

const DIMENSION_BUTTON =
  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap pointer-coarse:min-h-11';

const PILL =
  'inline-flex h-11 items-center gap-1.5 rounded-full bg-secondary ps-3 pe-2 text-sm font-medium text-secondary-foreground hover:bg-muted md:h-9 pointer-coarse:min-h-11';

/**
 * A GET form, so the filters work before hydration and every filtered view has a URL. After hydration, a pill and Clear all are router navigations
 * to the same URL a submit would load, and buttons replace the disclosure: Filters opens a sheet below 768px, and each dimension a popover from 768px.
 * The sheet and popovers are imported on the first press of a button; a press waiting on that import is dropped by Escape, a navigation, or a press of
 * another button. A view container here would be server-rendered and break hydration, so they are created with `createComponent`, attached to
 * `ApplicationRef`, and render through the CDK overlay.
 */
@Component({
  selector: 'app-league-filters',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronDown, lucideSlidersHorizontal, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '(document:keydown.escape)': 'dropPendingPress()' },
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
            @if (groups.length && enhanced()) {
              <div data-filter-buttons class="flex flex-wrap items-center gap-2">
                <button
                  #sheetButton
                  type="button"
                  [class]="filtersButtonClass"
                  aria-haspopup="dialog"
                  [attr.aria-expanded]="sheetOpen()"
                  [attr.aria-controls]="sheetOpen() ? overlays()?.sheetId() : null"
                  [attr.aria-busy]="pressed() === 'sheet' ? 'true' : null"
                  (click)="press('sheet', sheetButton)"
                >
                  <ng-icon
                    name="lucideSlidersHorizontal"
                    class="text-base"
                    aria-hidden="true"
                  />Filters
                  @if (activeCount()) {
                    <span
                      class="flex size-5 items-center justify-center rounded-full bg-foreground text-xs tabular-nums text-background"
                      >{{ activeCount() }}</span
                    ><span class="sr-only"> active</span>
                  }
                </button>
                <div class="hidden flex-wrap gap-2 md:flex">
                  @for (button of dimensionButtons(); track button.name) {
                    <button
                      #dimensionButton
                      type="button"
                      [class]="button.choice ? activeDimensionClass : idleDimensionClass"
                      [attr.aria-expanded]="openPopover() === button.name"
                      [attr.aria-controls]="openPopover() === button.name ? button.popoverId : null"
                      [attr.aria-busy]="pressed() === button.name ? 'true' : null"
                      (click)="press(button.name, dimensionButton)"
                    >
                      <span
                        >{{ button.prefix
                        }}<span class="font-normal">{{ button.choice }}</span></span
                      ><ng-icon
                        name="lucideChevronDown"
                        class="text-base text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  }
                </div>
              </div>
            } @else if (groups.length) {
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
  readonly facets = input<readonly LeagueFacet[] | undefined>(undefined);
  readonly sportLeagueCounts = input<SportCounts | undefined>(undefined);
  readonly sport = input<Sport | undefined>(undefined);

  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly loadOverlayChunk = inject(LOAD_FILTER_OVERLAYS);
  private readonly countStatus = viewChild<ElementRef<HTMLElement>>('countStatus');
  private readonly sheetButton = viewChild<ElementRef<HTMLButtonElement>>('sheetButton');
  private countFocusRequested = false;

  /** The server HTML and the first browser render keep the disclosure, so hydration finds what the server drew. */
  protected readonly enhanced = signal(false);
  protected readonly pressed = signal<FilterOverlay | null>(null);
  protected readonly overlays = signal<LeagueFilterOverlays | null>(null);
  private overlaysLoad: Promise<LeagueFilterOverlays | null> | null = null;
  private overlaysRef: ComponentRef<LeagueFilterOverlays> | null = null;

  protected readonly sheetOpen = computed(() => this.overlays()?.sheetOpen() ?? false);
  protected readonly openPopover = computed(() => this.overlays()?.openPopover() ?? null);

  protected readonly wrapperClass = CHIP_CHOICE_WRAPPER_CLASSES;
  protected readonly inputClass = CHIP_CHOICE_INPUT_CLASSES;
  protected readonly chipClass = CHIP_CHOICE_LABEL_CLASSES;
  protected readonly submitClass = PRIMARY_BUTTON_LARGE;
  protected readonly pillClass = PILL;
  protected readonly filtersButtonClass = FILTERS_BUTTON;
  protected readonly activeDimensionClass = `${DIMENSION_BUTTON} border-foreground bg-muted`;
  protected readonly idleDimensionClass = `${DIMENSION_BUTTON} border-input hover:bg-muted aria-expanded:bg-muted`;

  private readonly filtered = computed(() => hasDivisionFilters(this.filters()));

  protected readonly activeCount = computed(() => filterPills(this.filters()).length);

  protected readonly dimensionButtons = computed(() =>
    (this.groups() ?? []).map((group) => {
      const choice = group.options
        .filter((option) => option.checked)
        .map((option) => option.label)
        .join(', ');
      return {
        name: group.name,
        prefix: choice ? `${group.legend}: ` : group.legend,
        choice,
        popoverId: filterPopoverId(group.name),
      };
    }),
  );

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
    afterNextRender(() => this.enhanced.set(true));
    this.destroyRef.onDestroy(() => {
      this.overlaysRef?.destroy();
      this.overlaysRef = null;
    });
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.dropPendingPress());
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
    const filters = filtersFromForm(event.target as HTMLFormElement);
    void this.router.navigate([this.path()], { queryParams: this.queryFor(filters) });
  }

  protected dropPendingPress(): void {
    this.pressed.set(null);
  }

  /** Brain leaves a click on the popover's own button to that button, so a press of the open popover's button closes it here. */
  protected async press(overlay: FilterOverlay, trigger: HTMLElement): Promise<void> {
    const loaded = this.overlays();
    if (overlay !== 'sheet' && loaded?.openPopover() === overlay) {
      loaded.closePopover(overlay);
      return;
    }
    this.pressed.set(overlay);
    this.overlaysLoad ??= this.loadOverlays().catch((error: unknown) => {
      this.overlaysLoad = null;
      throw error;
    });
    let overlays: LeagueFilterOverlays | null;
    try {
      overlays = await this.overlaysLoad;
    } catch {
      // A failed chunk load opens nothing, and the next press tries it again.
      if (this.pressed() === overlay) this.pressed.set(null);
      return;
    }
    if (this.pressed() !== overlay) return;
    this.pressed.set(null);
    if (!overlays || this.destroyRef.destroyed || this.router.currentNavigation()) return;
    if (overlay === 'sheet') overlays.openSheet();
    else overlays.openPopoverFor(overlay, trigger);
  }

  private async loadOverlays(): Promise<LeagueFilterOverlays | null> {
    const { LeagueFilterOverlays } = await this.loadOverlayChunk();
    if (this.destroyRef.destroyed) return null;
    const ref = createComponent(LeagueFilterOverlays, {
      environmentInjector: this.environmentInjector,
      elementInjector: this.injector,
      bindings: [
        inputBinding('path', this.path),
        inputBinding('sportView', this.sportView),
        inputBinding('filters', this.filters),
        inputBinding('facets', this.facets),
        inputBinding('sportLeagueCounts', this.sportLeagueCounts),
        inputBinding('sport', this.sport),
        inputBinding('locationsPage', this.locationsPage),
        inputBinding('total', this.total),
        inputBinding('sheetTrigger', () => this.sheetButton()?.nativeElement),
        inputBinding('focusCount', () => this.focusCountAfterRender),
      ],
    });
    this.overlaysRef = ref;
    this.appRef.attachView(ref.hostView);
    try {
      ref.changeDetectorRef.detectChanges();
    } catch (error) {
      ref.destroy();
      this.overlaysRef = null;
      throw error;
    }
    this.overlays.set(ref.instance);
    return ref.instance;
  }

  private readonly focusCountAfterRender = (): void => {
    if (this.destroyRef.destroyed) return;
    afterNextRender(() => this.countStatus()?.nativeElement.focus(), { injector: this.injector });
  };
}
