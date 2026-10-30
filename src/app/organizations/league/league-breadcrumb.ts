import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { adminPath } from '../admin/admin-path';
import type { OrganizerLeague } from './league-context';
import { leaguePath } from './league-path';

const CRUMB_LINK =
  'inline-flex min-h-11 items-center rounded-md font-medium hover:text-foreground hover:underline md:min-h-0';
const CURRENT_CRUMB_LINK = `${CRUMB_LINK} text-foreground`;

interface Crumb {
  label: string;
  path: string;
}

/** A league organizer who is not an org admin is sent to `/app`, because the admin area shows them the no-access view. */
@Component({
  selector: 'app-league-breadcrumb',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <nav aria-label="Breadcrumb">
      <ol role="list" class="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        @for (crumb of crumbs(); track crumb.path) {
          @if (!$first) {
            <li aria-hidden="true">
              <ng-icon
                name="lucideChevronRight"
                class="translate-y-0.5 text-sm"
                aria-hidden="true"
              />
            </li>
          }
          <li>
            <a [routerLink]="crumb.path" [class]="crumbLink">{{ crumb.label }}</a>
          </li>
        }
        <li aria-hidden="true">
          <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" aria-hidden="true" />
        </li>
        <li>
          <a [routerLink]="currentPath()" aria-current="page" [class]="currentCrumbLink">{{
            league().name
          }}</a>
        </li>
      </ol>
    </nav>
  `,
})
export class LeagueBreadcrumb {
  readonly league = input.required<OrganizerLeague>();

  protected readonly crumbLink = CRUMB_LINK;
  protected readonly currentCrumbLink = CURRENT_CRUMB_LINK;

  protected readonly crumbs = computed<Crumb[]>(() => {
    const { role, organization } = this.league();
    if (role !== 'orgAdmin') return [{ label: 'Your organizations', path: '/app' }];
    return [
      { label: organization.name, path: adminPath(organization.slug) },
      { label: 'Leagues', path: adminPath(organization.slug, 'leagues') },
    ];
  });

  protected readonly currentPath = computed(() => {
    const { organization, slug } = this.league();
    return leaguePath(organization.slug, slug);
  });
}
