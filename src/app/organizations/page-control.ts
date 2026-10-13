import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideEllipsis } from '@ng-icons/lucide';
import { LIST_PAGE_SIZE, listPageQuery } from '../core/list-page';

// The class strings of the numbered control, as design/mockups/127-128-public-seasons.html draws
// it (helm's `buttonVariants` output unmerged, with #61's focus change). They are constants, not
// `buttonVariants()` calls, so the public page's chunk loads no class-merging code. The spec
// checks them against `buttonVariants`, so a change to the helm button shows up there.
const BASE =
  "data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0";
const GHOST =
  'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground';

/** `hlmBtn variant="ghost"` with a width of 2rem and no padding below 640px: Previous and Next. */
export const GHOST_BUTTON = `${BASE} ${GHOST} h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 max-sm:w-8 max-sm:px-0`;
/** `hlmBtn variant="ghost" size="icon"`: a page number that is not the current one. */
export const GHOST_ICON_BUTTON = `${BASE} ${GHOST} size-8 tabular-nums`;
/** `hlmBtn variant="secondary" size="icon"`: the current page. */
export const CURRENT_PAGE_BUTTON = `${BASE} bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground size-8 font-semibold tabular-nums`;

/**
 * An item of the page-number list. A gap shows in one view only: `wide` (from 640px) or `narrow`
 * (below). A page with `narrowHidden` shows from 640px only.
 */
export type PageWindowItem =
  | { readonly kind: 'page'; readonly n: number; readonly narrowHidden: boolean }
  | { readonly kind: 'gap'; readonly view: 'wide' | 'narrow' };

/** Lists up to this many pages in full. */
const ALL_PAGES_UP_TO = 5;

/**
 * The page numbers the control lists for `page` of `pageCount`, with the gaps between them (the
 * approved mockup, #103). Up to 5 pages are listed in full. With more, from 640px it keeps the
 * first, the last, the current page, and its neighbours (`1 2 3 4 … 6`); below 640px the first,
 * the current, and the last (`1 … 3 … 6`), so the control fits at 320px. Each gap is placed so
 * that, with the other view's items and gaps hidden, the list reads in order.
 */
export function pageWindow(page: number, pageCount: number): PageWindowItem[] {
  if (pageCount <= ALL_PAGES_UP_TO) {
    return Array.from({ length: pageCount }, (_, i) => ({
      kind: 'page' as const,
      n: i + 1,
      narrowHidden: false,
    }));
  }
  const inRange = (n: number) => n >= 1 && n <= pageCount;
  const wide = [...new Set([1, page - 1, page, page + 1, pageCount].filter(inRange))].sort(
    (a, b) => a - b,
  );
  const narrow = [...new Set([1, page, pageCount])].sort((a, b) => a - b);
  const items: PageWindowItem[] = [];
  for (const n of [...new Set([...wide, ...narrow])].sort((a, b) => a - b)) {
    const w = wide.indexOf(n);
    if (w > 0 && n - wide[w - 1] > 1) items.push({ kind: 'gap', view: 'wide' });
    items.push({ kind: 'page', n, narrowHidden: !narrow.includes(n) });
    const k = narrow.indexOf(n);
    if (k !== -1 && k < narrow.length - 1 && narrow[k + 1] - n > 1) {
      items.push({ kind: 'gap', view: 'narrow' });
    }
  }
  return items;
}

/** The range text of page `page` of a list of `total` rows: `11–15 of 26`. */
export function rangeText(page: number, total: number): string {
  const first = (page - 1) * LIST_PAGE_SIZE + 1;
  const last = Math.min(page * LIST_PAGE_SIZE, total);
  return `${first}–${last} of ${total}`;
}

/**
 * The numbered control under a list on a public page (#103's, drawn in
 * design/mockups/127-128-public-seasons.html): the range text, Previous and Next (an
 * `aria-disabled` element, not a link, at either end), and the numbered links with
 * `aria-current="page"` on the current one. It renders only when the list's `total` is more than
 * one page, from the query result and never from the rows on screen.
 *
 * Each link is a router link to `path` with `?page=N` (none for page 1) and the fragment of the
 * list's panel, built from the query result's page numbers only, so the server HTML holds no value
 * from the request's query string. A plain click on a link to another page emits `pageActivated`
 * with its number, so the page can move focus to the panel heading once the page has loaded.
 */
@Component({
  selector: 'app-page-control',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideEllipsis })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (total() > pageSize) {
      <nav
        [attr.aria-label]="label()"
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3 md:px-5"
      >
        <p class="text-sm text-muted-foreground tabular-nums">
          {{ range() }}<span class="sr-only"> {{ noun() }}</span>
        </p>
        <ul role="list" class="flex items-center gap-1">
          <li>
            @if (page() > 1) {
              <a
                [routerLink]="path()"
                [queryParams]="query(page() - 1)"
                [fragment]="fragment()"
                (click)="activated(page() - 1)"
                data-slot="button"
                [class]="ghostButton"
                ><ng-icon
                  name="lucideChevronLeft"
                  data-icon="inline-start"
                  aria-hidden="true"
                /><span class="max-sm:sr-only">Previous</span><span class="sr-only"> page</span></a
              >
            } @else {
              <span
                aria-disabled="true"
                data-slot="button"
                [class]="ghostButton + ' pointer-events-none opacity-50'"
                ><ng-icon
                  name="lucideChevronLeft"
                  data-icon="inline-start"
                  aria-hidden="true"
                /><span class="max-sm:sr-only">Previous</span
                ><span class="sr-only"> page</span></span
              >
            }
          </li>
          @for (item of items(); track $index) {
            @if (item.kind === 'gap') {
              <li aria-hidden="true" [class]="item.view === 'wide' ? 'max-sm:hidden' : 'sm:hidden'">
                <span class="flex size-8 items-center justify-center text-muted-foreground"
                  ><ng-icon name="lucideEllipsis" class="text-base" aria-hidden="true"
                /></span>
              </li>
            } @else {
              <li [class]="item.narrowHidden ? 'max-sm:hidden' : ''">
                <a
                  [routerLink]="path()"
                  [queryParams]="query(item.n)"
                  [fragment]="fragment()"
                  [attr.aria-current]="item.n === page() ? 'page' : null"
                  (click)="activated(item.n)"
                  data-slot="button"
                  [class]="item.n === page() ? currentButton : ghostIconButton"
                  ><span class="sr-only">Page </span>{{ item.n }}</a
                >
              </li>
            }
          }
          <li>
            @if (page() < pageCount()) {
              <a
                [routerLink]="path()"
                [queryParams]="query(page() + 1)"
                [fragment]="fragment()"
                (click)="activated(page() + 1)"
                data-slot="button"
                [class]="ghostButton"
                ><span class="max-sm:sr-only">Next</span><span class="sr-only"> page</span
                ><ng-icon name="lucideChevronRight" data-icon="inline-end" aria-hidden="true"
              /></a>
            } @else {
              <span
                aria-disabled="true"
                data-slot="button"
                [class]="ghostButton + ' pointer-events-none opacity-50'"
                ><span class="max-sm:sr-only">Next</span><span class="sr-only"> page</span
                ><ng-icon name="lucideChevronRight" data-icon="inline-end" aria-hidden="true"
              /></span>
            }
          </li>
        </ul>
      </nav>
    }
  `,
})
export class PageControl {
  /** The `nav`'s accessible name, for example `Seasons pages`. */
  readonly label = input.required<string>();
  /** What the rows are, read after the range for screen readers (`seasons`). */
  readonly noun = input.required<string>();
  /** The page shown and the number of pages, as the query result gives them. */
  readonly page = input.required<number>();
  readonly pageCount = input.required<number>();
  /** The list's total, from the query result. */
  readonly total = input.required<number>();
  /** The page's path, without a query string or fragment. */
  readonly path = input.required<string>();
  /** The id of the list's panel, without the `#`. */
  readonly fragment = input.required<string>();
  /** A plain click on a link to a page other than the current one. */
  readonly pageActivated = output<number>();

  protected readonly pageSize = LIST_PAGE_SIZE;
  protected readonly ghostButton = GHOST_BUTTON;
  protected readonly ghostIconButton = GHOST_ICON_BUTTON;
  protected readonly currentButton = CURRENT_PAGE_BUTTON;
  protected readonly range = computed(() => rangeText(this.page(), this.total()));
  protected readonly items = computed(() => pageWindow(this.page(), this.pageCount()));

  protected query(page: number) {
    return listPageQuery(page);
  }

  protected activated(page: number): void {
    if (page !== this.page()) this.pageActivated.emit(page);
  }
}
