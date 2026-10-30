import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { adminPath } from '../admin/admin-path';
import type { OrganizerLeague } from './league-context';
import { leaguePath } from './league-path';

const CRUMB_LINK =
  'inline-flex max-w-full items-center rounded-md font-medium hover:text-foreground hover:underline pointer-coarse:min-h-11';
const CURRENT_CRUMB_LINK = `${CRUMB_LINK} text-foreground`;

const NAME_CRUMB = 'flex min-w-11';
const FIXED_LABEL_CRUMB = 'flex shrink-0';

interface Crumb {
  label: string;
  path: string;
  /** A fixed label, unlike a name, is short and never needs shortening. */
  fixedLabel: boolean;
}

/**
 * A league organizer who is not an org admin is sent to `/app`, because the admin area shows them the no-access view.
 * The trail stays on one line so its height is known before the league loads, which keeps the h1 where the skeleton drew it.
 */
@Component({
  selector: 'app-league-breadcrumb',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <nav aria-label="Breadcrumb">
      <ol
        role="list"
        class="flex flex-nowrap items-center gap-x-1.5 text-sm whitespace-nowrap text-muted-foreground"
      >
        @for (crumb of crumbs(); track crumb.path) {
          @if (!$first) {
            <li aria-hidden="true" class="shrink-0">
              <ng-icon
                name="lucideChevronRight"
                class="translate-y-0.5 text-sm"
                aria-hidden="true"
              />
            </li>
          }
          <li [class]="crumb.fixedLabel ? fixedLabelCrumb : nameCrumb">
            <a [routerLink]="crumb.path" [class]="crumbLink"
              ><span class="truncate">{{ crumb.label }}</span></a
            >
          </li>
        }
        <li aria-hidden="true" class="shrink-0">
          <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
        </li>
        <li class="flex min-w-16 shrink-100">
          <a [routerLink]="currentPath()" aria-current="page" [class]="currentCrumbLink"
            ><span class="truncate">{{ league().name }}</span></a
          >
        </li>
      </ol>
    </nav>
  `,
})
export class LeagueBreadcrumb {
  readonly league = input.required<OrganizerLeague>();

  protected readonly crumbLink = CRUMB_LINK;
  protected readonly currentCrumbLink = CURRENT_CRUMB_LINK;
  protected readonly nameCrumb = NAME_CRUMB;
  protected readonly fixedLabelCrumb = FIXED_LABEL_CRUMB;

  protected readonly crumbs = computed<Crumb[]>(() => {
    const { role, organization } = this.league();
    if (role !== 'orgAdmin') {
      return [{ label: 'Your organizations', path: '/app', fixedLabel: true }];
    }
    return [
      { label: organization.name, path: adminPath(organization.slug), fixedLabel: false },
      { label: 'Leagues', path: adminPath(organization.slug, 'leagues'), fixedLabel: true },
    ];
  });

  protected readonly currentPath = computed(() => {
    const { organization, slug } = this.league();
    return leaguePath(organization.slug, slug);
  });
}
