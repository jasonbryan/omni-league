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
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight, lucideCircleAlert } from '@ng-icons/lucide';
import { OrganizationMark } from '../organizations/organization-mark';
import { organizationPath } from '../organizations/organization-path';
import { PageControl } from '../organizations/page-control';
import { sportsCommaList } from '../organizations/sport-list';
import { FIND_PATH, type FindOrganizations } from './find-path';

export type OrganizationsState = 'loading' | 'error' | 'ready';

const BAR = 'block rounded-md bg-muted motion-safe:animate-pulse';

const LIST_CLASSES = 'mt-4 grid gap-x-8 divide-y divide-border md:grid-cols-2 md:divide-y-0';

const LINK_CLASSES =
  'rounded-md group-hover:underline focus-visible:outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring';

/** Shaped like the rows, so the list replaces it without a jump. */
@Component({
  selector: 'app-find-organizations-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'find-organizations-skeleton' },
  template: `
    <p role="status" class="sr-only">Loading organizations.</p>
    <div class="${LIST_CLASSES}">
      @for (row of rows; track row) {
        <div class="flex min-h-18 items-center gap-4 py-4 md:border-b md:border-border">
          <span aria-hidden="true" class="${BAR} size-11 shrink-0 rounded-xl"></span>
          <div class="flex-1 space-y-2">
            <span aria-hidden="true" class="${BAR} h-5 w-1/2"></span>
            <span aria-hidden="true" class="${BAR} h-4 w-3/4"></span>
          </div>
        </div>
      }
    </div>
  `,
})
export class FindOrganizationsSkeleton {
  protected readonly rows = [1, 2, 3, 4];
}

/**
 * The page control links are built from the query result's page numbers only, so the server HTML holds no value from the request's query string.
 */
@Component({
  selector: 'app-find-organizations',
  imports: [FindOrganizationsSkeleton, NgIcon, OrganizationMark, PageControl, RouterLink],
  providers: [provideIcons({ lucideChevronRight, lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="border-t border-border">
      <section
        aria-labelledby="organizations-heading"
        class="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-12"
      >
        <h2
          #heading
          id="organizations-heading"
          tabindex="-1"
          class="text-xl font-semibold tracking-tight focus:outline-none md:text-2xl"
        >
          Organizations
        </h2>
        @switch (state()) {
          @case ('loading') {
            <app-find-organizations-skeleton class="mt-4" />
          }
          @case ('error') {
            <div
              data-slot="alert"
              role="alert"
              class="group/alert relative mt-4 grid w-full max-w-xl gap-0.5 rounded-lg border bg-card px-2.5 py-2 text-start text-sm text-destructive has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)]"
            >
              <ng-icon name="lucideCircleAlert" aria-hidden="true" />
              <div class="col-start-2 font-medium">The organizations could not be loaded.</div>
              <div class="col-start-2 text-sm text-balance text-muted-foreground">
                Check your connection, then try again. You can still search above.
              </div>
              <a
                [href]="retryHref()"
                class="col-start-2 mt-1 inline-flex w-fit items-center rounded-md font-medium text-foreground underline underline-offset-4 pointer-coarse:min-h-11"
                >Try again</a
              >
            </div>
          }
          @default {
            @if (rows().length > 0) {
              <ul role="list" [class]="listClasses" [attr.aria-busy]="busy() ? 'true' : null">
                @for (row of rows(); track row.href) {
                  <li class="group relative md:border-b md:border-border">
                    <div class="flex min-h-18 items-center gap-4 py-4">
                      <app-organization-mark size="row" [name]="row.name" [logoUrl]="row.logoUrl" />
                      <div class="min-w-0 flex-1">
                        <h3 class="font-medium">
                          <a [routerLink]="row.href" [class]="linkClasses">{{ row.name }}</a>
                        </h3>
                        @if (row.where) {
                          <p class="mt-0.5 text-sm text-muted-foreground">{{ row.where }}</p>
                        }
                      </div>
                      <ng-icon
                        name="lucideChevronRight"
                        class="shrink-0 text-lg text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                  </li>
                }
              </ul>
              @if (paging(); as paging) {
                <div class="-mx-4 mt-2 md:-mx-5">
                  <app-page-control
                    label="Organizations pages"
                    noun="organizations"
                    [page]="paging.page"
                    [pageCount]="paging.pageCount"
                    [total]="paging.total"
                    [path]="path"
                    [fragment]="undefined"
                    (pageActivated)="pageRequested = true"
                  />
                </div>
              }
            } @else {
              <div class="mt-4 max-w-md">
                <p class="font-medium">No organizations have published a league yet.</p>
                <p class="mt-1 text-sm text-muted-foreground">
                  An organization appears here once it publishes a league.
                </p>
              </div>
            }
          }
        }
      </section>
    </div>
  `,
})
export class FindOrganizationsList {
  readonly state = input.required<OrganizationsState>();
  readonly result = input<FindOrganizations | undefined>(undefined);
  /** The shown page is held while the next one loads. */
  readonly busy = input(false);
  readonly retryHref = input.required<string>();

  protected readonly path = FIND_PATH;
  protected readonly listClasses = LIST_CLASSES;
  protected readonly linkClasses = LINK_CLASSES;

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly injector = inject(Injector);

  protected pageRequested = false;

  protected readonly rows = computed(() =>
    (this.result()?.rows ?? []).map((organization) => ({
      href: organizationPath(organization.slug),
      name: organization.name,
      logoUrl: organization.logoUrl,
      where: [sportsCommaList(organization.sportNames), organization.cityState]
        .filter(Boolean)
        .join(' · '),
    })),
  );

  protected readonly paging = computed(() => {
    const result = this.result();
    return result ? { page: result.page, pageCount: result.pageCount, total: result.total } : null;
  });

  constructor() {
    // Focus moves only for a click on a page link: a live update of the shown page leaves it alone.
    effect(() => {
      this.result();
      untracked(() => {
        if (!this.pageRequested) return;
        this.pageRequested = false;
        afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
      });
    });
  }
}
