import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { type Params } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight } from '@ng-icons/lucide';
import { LIST_PAGE_SIZE, listPageQuery } from '../core/list-page';
import { GHOST_BUTTON, HlmPaginationImports } from '../ui/pagination';

export type PageWindowItem =
  | { readonly kind: 'page'; readonly n: number; readonly narrowHidden: boolean }
  | { readonly kind: 'gap'; readonly view: 'wide' | 'narrow' };

const ALL_PAGES_UP_TO = 5;

// With 44px touch buttons, Previous, five pages, and Next are wider than 320px.
const ALL_PAGES_NARROW_UP_TO = 4;

/**
 * Below 640px the list keeps the first, the current, and the last page (`1 … 3 … 6`), so the control fits at 320px.
 * Each gap is placed so that, with the other view's items and gaps hidden, the list reads in order.
 */
export function pageWindow(page: number, pageCount: number): PageWindowItem[] {
  if (pageCount <= ALL_PAGES_NARROW_UP_TO) {
    return Array.from({ length: pageCount }, (_, i) => ({
      kind: 'page' as const,
      n: i + 1,
      narrowHidden: false,
    }));
  }
  const inRange = (n: number) => n >= 1 && n <= pageCount;
  const wide =
    pageCount <= ALL_PAGES_UP_TO
      ? Array.from({ length: pageCount }, (_, i) => i + 1)
      : [...new Set([1, page - 1, page, page + 1, pageCount].filter(inRange))].sort(
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

export function rangeText(page: number, total: number, shown?: number): string {
  const first = (page - 1) * LIST_PAGE_SIZE + 1;
  if (shown === 0) return `0 of ${total}`;
  const last = Math.min(
    page * LIST_PAGE_SIZE,
    total,
    shown === undefined ? Infinity : first + shown - 1,
  );
  return `${first}–${last} of ${total}`;
}

/**
 * Each link is built from the query result's page numbers only, so the server HTML holds no value from the request's query string.
 * It renders only when the list's `total` is more than one page, from the query result and never from the rows on screen.
 */
@Component({
  selector: 'app-page-control',
  imports: [NgIcon, HlmPaginationImports],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (total() > pageSize) {
      <nav
        hlmPagination
        [aria-label]="label()"
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3 md:px-5"
      >
        <p class="text-sm text-muted-foreground tabular-nums">
          {{ range() }}<span class="sr-only"> {{ noun() }}</span>
        </p>
        <ul hlmPaginationContent>
          <li hlmPaginationItem>
            @if (page() > 1) {
              <a
                hlmPaginationLink
                size="default"
                [link]="path()"
                [queryParams]="query(page() - 1)"
                [fragment]="fragment()"
                (activated)="onActivated(page() - 1, $event)"
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
              <li
                hlmPaginationItem
                aria-hidden="true"
                [class]="item.view === 'wide' ? 'max-sm:hidden' : 'sm:hidden'"
              >
                <span hlmPaginationEllipsis></span>
              </li>
            } @else {
              <li hlmPaginationItem [class]="item.narrowHidden ? 'max-sm:hidden' : ''">
                <a
                  hlmPaginationLink
                  [isActive]="item.n === page()"
                  [link]="path()"
                  [queryParams]="query(item.n)"
                  [fragment]="fragment()"
                  (activated)="onActivated(item.n, $event)"
                  ><span class="sr-only">Page </span>{{ item.n }}</a
                >
              </li>
            }
          }
          <li hlmPaginationItem>
            @if (page() < pageCount()) {
              <a
                hlmPaginationLink
                size="default"
                [link]="path()"
                [queryParams]="query(page() + 1)"
                [fragment]="fragment()"
                (activated)="onActivated(page() + 1, $event)"
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
  readonly label = input.required<string>();
  readonly noun = input.required<string>();
  readonly page = input.required<number>();
  readonly pageCount = input.required<number>();
  readonly total = input.required<number>();
  /** The rows on screen, when a row can leave the page after the query answered. */
  readonly shown = input<number | undefined>(undefined);
  readonly path = input.required<string>();
  readonly fragment = input.required<string | undefined>();
  readonly queryFor = input<(page: number) => Params>(listPageQuery);
  readonly pageActivated = output<number>();

  protected readonly pageSize = LIST_PAGE_SIZE;
  protected readonly ghostButton = GHOST_BUTTON;
  protected readonly range = computed(() => rangeText(this.page(), this.total(), this.shown()));
  protected readonly items = computed(() => pageWindow(this.page(), this.pageCount()));

  protected query(page: number): Params {
    return this.queryFor()(page);
  }

  protected onActivated(page: number, event: MouseEvent): void {
    const plain =
      event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    if (plain && page !== this.page()) this.pageActivated.emit(page);
  }
}
