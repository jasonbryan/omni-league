import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { Router, type Params } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { BrnPopover } from '@spartan-ng/brain/popover';
import {
  NO_DIVISION_FILTERS,
  formatAndLevelSport,
  sportsWithLeagues,
  type DivisionFilters,
} from '../../../convex/lib/leagueFilters';
import type { Sport, SportCounts } from '../../../convex/lib/sports';
import { HlmButton } from '../ui/button';
import { PRIMARY_BUTTON, PRIMARY_BUTTON_LARGE } from '../ui/button/button-classes';
import {
  CHIP_CHOICE_INPUT_CLASSES,
  CHIP_CHOICE_LABEL_CLASSES,
  CHIP_CHOICE_WRAPPER_CLASSES,
} from '../ui/chip/chip-classes';
import { HlmPopover } from '../ui/popover/hlm-popover';
import { HlmPopoverContent } from '../ui/popover/hlm-popover-content';
import { HlmPopoverPortal } from '../ui/popover/hlm-popover-portal';
import {
  HlmSheet,
  HlmSheetClose,
  HlmSheetContent,
  HlmSheetFooter,
  HlmSheetPortal,
  HlmSheetTitle,
} from '../ui/sheet';
import {
  filterGroups,
  filterPopoverId,
  filtersFromForm,
  type FilterGroup,
  type FilterParam,
  type LeagueFacet,
} from './division-filters';
import {
  draftLeagueCount,
  hiddenDraftInputs,
  offeredFacets,
  showLeaguesLabel,
} from './filter-draft';
import { listPagesQuery } from './organization-path';

const DIMENSION_KEYS: Readonly<Record<FilterParam, keyof DivisionFilters>> = {
  gender: 'gender',
  format: 'playersPerSide',
  level: 'level',
  age: 'ageGroup',
};

const CLEAR_LINK =
  'inline-flex items-center rounded-md text-sm font-medium underline underline-offset-4 pointer-coarse:min-h-11';

export type FilterOverlay = 'sheet' | FilterParam;

interface PendingNavigation {
  readonly query: Params;
  readonly focusCount: boolean;
}

function plainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

@Component({
  selector: 'app-filter-fieldset',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset>
      <legend class="text-sm font-medium">{{ group().legend }}</legend>
      <div class="mt-3 flex flex-wrap gap-2">
        @for (option of group().options; track option.value) {
          <label [class]="wrapperClass"
            ><input
              type="checkbox"
              [attr.name]="option.name"
              [attr.value]="option.value"
              [checked]="option.checked"
              [class]="inputClass"
            /><span [class]="chipClass">{{ option.label }}</span></label
          >
        }
      </div>
    </fieldset>
  `,
})
export class FilterFieldset {
  readonly group = input.required<FilterGroup>();

  protected readonly wrapperClass = CHIP_CHOICE_WRAPPER_CLASSES;
  protected readonly inputClass = CHIP_CHOICE_INPUT_CLASSES;
  protected readonly chipClass = CHIP_CHOICE_LABEL_CLASSES;
}

/**
 * The filter bar imports this file with `import()` on the first press of a filter button, so the page loads none of the sheet, popover, or overlay code until then.
 * Both overlays render in the CDK overlay container, outside the page's form, so each holds a GET form of its own with the whole draft in it.
 * A press opens one draft read from the URL; Show applies all of it and closing discards it. Show and the Clear links navigate once the overlay has closed, so focus is back on the pressed button first.
 */
@Component({
  selector: 'app-league-filter-overlays',
  imports: [
    CdkTrapFocus,
    FilterFieldset,
    HlmButton,
    HlmPopover,
    HlmPopoverContent,
    HlmPopoverPortal,
    HlmSheet,
    HlmSheetClose,
    HlmSheetContent,
    HlmSheetFooter,
    HlmSheetPortal,
    HlmSheetTitle,
    NgIcon,
  ],
  providers: [provideIcons({ lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-sheet
      [side]="'bottom'"
      [autoFocus]="'[aria-label=&quot;Close filters&quot;]'"
      [restoreFocus]="sheetTrigger() ?? true"
      (closed)="navigatePending()"
    >
      <hlm-sheet-content
        *hlmSheetPortal
        [showCloseButton]="false"
        class="top-10 gap-0 rounded-t-2xl border-transparent"
      >
        <div class="flex items-center justify-between border-b border-border py-1 ps-4 pe-2">
          <h2 hlmSheetTitle class="text-base font-semibold">Filters</h2>
          <button
            hlmBtn
            hlmSheetClose
            type="button"
            variant="ghost"
            size="icon-lg"
            class="size-11"
            aria-label="Close filters"
          >
            <ng-icon name="lucideX" class="text-xl" aria-hidden="true" />
          </button>
        </div>
        <form
          method="get"
          [attr.action]="path()"
          class="flex min-h-0 flex-1 flex-col"
          (change)="readDraft($event)"
          (submit)="apply($event, 'sheet')"
        >
          <div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
            @for (group of groups(); track group.name) {
              <app-filter-fieldset [group]="group" />
            }
            @for (hidden of sheetHidden(); track $index) {
              <input type="hidden" [attr.name]="hidden.name" [attr.value]="hidden.value" />
            }
            @if (locationsPage() > 1) {
              <input type="hidden" name="locations" [attr.value]="locationsPage()" />
            }
          </div>
          <div
            hlmSheetFooter
            class="flex-row items-center justify-between gap-3 border-t border-border px-4 py-3"
          >
            <a
              [attr.href]="hrefFor(clearAllQuery())"
              [class]="clearLink"
              (click)="clear($event, 'sheet', clearAllQuery())"
              >Clear all</a
            ><button type="submit" data-slot="button" [class]="showButtonLarge">
              {{ showLabel() }}
            </button>
          </div>
          <p role="status" class="sr-only">{{ countStatus() }}</p>
        </form>
      </hlm-sheet-content>
    </hlm-sheet>
    @for (group of groups(); track group.name) {
      <hlm-popover
        [id]="paneId(group.name)"
        [role]="null"
        align="start"
        sideOffset="8"
        (stateChanged)="popoverStateChanged(group.name, $event)"
        (closed)="popoverClosed(group.name)"
      >
        <hlm-popover-content
          *hlmPopoverPortal
          class="w-80"
          role="dialog"
          cdkTrapFocus
          [id]="popoverId(group.name)"
          [attr.aria-label]="group.legend"
        >
          <form
            method="get"
            [attr.action]="path()"
            (change)="readDraft($event)"
            (submit)="apply($event, group.name)"
          >
            <app-filter-fieldset [group]="group" />
            @for (hidden of popoverHidden(group.name); track $index) {
              <input type="hidden" [attr.name]="hidden.name" [attr.value]="hidden.value" />
            }
            @if (locationsPage() > 1) {
              <input type="hidden" name="locations" [attr.value]="locationsPage()" />
            }
            <div class="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
              <a
                [attr.href]="hrefFor(clearQuery(group.name))"
                [class]="clearLink"
                class="min-h-9"
                (click)="clear($event, group.name, clearQuery(group.name))"
                >Clear {{ group.legend.toLowerCase() }}</a
              ><button type="submit" data-slot="button" [class]="showButton">
                {{ showLabel() }}
              </button>
            </div>
            <p role="status" class="sr-only">{{ countStatus() }}</p>
          </form>
        </hlm-popover-content>
      </hlm-popover>
    }
  `,
})
export class LeagueFilterOverlays {
  private readonly router = inject(Router);

  readonly path = input.required<string>();
  readonly sportView = input.required<boolean>();
  readonly filters = input.required<DivisionFilters>();
  readonly facets = input.required<readonly LeagueFacet[] | undefined>();
  readonly sportLeagueCounts = input.required<SportCounts | undefined>();
  readonly sport = input.required<Sport | undefined>();
  readonly locationsPage = input.required<number>();
  readonly total = input.required<number>();
  readonly sheetTrigger = input.required<HTMLElement | undefined>();

  /** Called once a Clear link's navigation ends, since the pressed link has left with its overlay. */
  readonly focusCount = input.required<() => void>();

  protected readonly clearLink = CLEAR_LINK;
  protected readonly showButton = PRIMARY_BUTTON;
  protected readonly showButtonLarge = PRIMARY_BUTTON_LARGE;

  private readonly sheet = viewChild.required(HlmSheet);
  private readonly popovers = viewChildren(HlmPopover, { read: BrnPopover });
  private readonly triggers = new Map<FilterParam, HTMLElement>();
  private pending: PendingNavigation | null = null;

  readonly sheetOpen = computed(() => this.sheet().stateComputed() === 'open');
  readonly sheetId = computed(() => this.sheet().id());
  private readonly openPopoverName = signal<FilterParam | null>(null);
  readonly openPopover = this.openPopoverName.asReadonly();

  private readonly draft = signal<DivisionFilters>(NO_DIVISION_FILTERS);

  private readonly formatAndLevelSport = computed(() =>
    formatAndLevelSport(this.sport(), sportsWithLeagues(this.sportLeagueCounts())),
  );

  protected readonly groups = computed(() =>
    filterGroups(
      offeredFacets(this.facets() ?? [], this.filters()),
      this.draft(),
      this.formatAndLevelSport(),
    ),
  );

  private readonly count = computed(() =>
    draftLeagueCount(
      this.facets(),
      this.draft(),
      this.sportLeagueCounts(),
      this.sport(),
      this.total(),
    ),
  );
  protected readonly showLabel = computed(() => showLeaguesLabel(this.count()));
  protected readonly countStatus = computed(() => {
    const count = this.count();
    if (count === undefined) return '';
    return `${count} ${count === 1 ? 'league matches' : 'leagues match'}`;
  });

  protected readonly sheetHidden = computed(() =>
    hiddenDraftInputs(
      this.draft(),
      this.groups().map((group) => group.name),
    ),
  );
  protected readonly clearAllQuery = computed(() => this.queryFor(NO_DIVISION_FILTERS));

  protected readonly paneId = (name: FilterParam) => `${filterPopoverId(name)}-pane`;
  protected readonly popoverId = filterPopoverId;

  protected popoverHidden(name: FilterParam) {
    return hiddenDraftInputs(this.draft(), [name]);
  }

  protected clearQuery(name: FilterParam): Params {
    return this.queryFor({ ...this.filters(), [DIMENSION_KEYS[name]]: [] });
  }

  protected hrefFor(query: Params): string {
    return this.router.serializeUrl(
      this.router.createUrlTree([this.path()], { queryParams: query }),
    );
  }

  openSheet(): void {
    this.draft.set(this.filters());
    this.sheet().open();
  }

  openPopoverFor(name: FilterParam, trigger: HTMLElement): void {
    const popover = this.popoverNamed(name);
    if (!popover) return;
    for (const other of this.popovers()) if (other !== popover) other.close();
    this.triggers.set(name, trigger);
    this.draft.set(this.filters());
    this.openPopoverName.set(name);
    popover.setOrigin(trigger);
    popover.open();
  }

  closePopover(name: FilterParam): void {
    this.popoverNamed(name)?.close();
  }

  private popoverNamed(name: FilterParam): BrnPopover | undefined {
    return this.popovers().find((popover) => popover.id() === this.paneId(name));
  }

  private queryFor(filters: DivisionFilters): Params {
    return listPagesQuery(
      { leagues: 1, locations: this.locationsPage() },
      this.sportView(),
      filters,
    );
  }

  protected readDraft(event: Event): void {
    const form = (event.target as HTMLElement).closest('form');
    if (form) this.draft.set(filtersFromForm(form));
  }

  protected apply(event: SubmitEvent, overlay: FilterOverlay): void {
    event.preventDefault();
    const draft = filtersFromForm(event.target as HTMLFormElement);
    this.closeFor(overlay, { query: this.queryFor(draft), focusCount: false });
  }

  protected clear(event: MouseEvent, overlay: FilterOverlay, query: Params): void {
    if (!plainClick(event)) return;
    event.preventDefault();
    this.closeFor(overlay, { query, focusCount: true });
  }

  private closeFor(overlay: FilterOverlay, navigation: PendingNavigation): void {
    this.pending = navigation;
    if (overlay === 'sheet') this.sheet().close();
    else this.closePopover(overlay);
  }

  protected popoverStateChanged(name: FilterParam, state: string): void {
    if (state === 'closed' && this.openPopoverName() === name) this.openPopoverName.set(null);
  }

  /** Brain gives focus back only to an element that had it at open, and WebKit does not focus a pressed button. */
  protected popoverClosed(name: FilterParam): void {
    const trigger = this.triggers.get(name);
    const active = trigger?.ownerDocument.activeElement;
    if (trigger?.isConnected && (!active || active === trigger.ownerDocument.body)) {
      trigger.focus({ preventScroll: true });
    }
    this.navigatePending();
  }

  protected navigatePending(): void {
    const navigation = this.pending;
    this.pending = null;
    if (!navigation) return;
    void this.router
      .navigate([this.path()], { queryParams: navigation.query })
      .then((navigated) => {
        if (navigation.focusCount && navigated !== false) this.focusCount()();
      });
  }
}
