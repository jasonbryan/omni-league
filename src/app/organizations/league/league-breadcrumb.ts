import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { HlmBreadcrumbImports } from '../../ui/breadcrumb';
import { adminPath } from '../admin/admin-path';
import type { OrganizerLeague } from './league-context';
import { leaguePath } from './league-path';

export const CRUMB_LINK =
  'inline-flex max-w-full items-center rounded-md font-medium hover:underline pointer-coarse:min-h-11';
export const LEAGUE_CRUMB_LINK = `${CRUMB_LINK} underline underline-offset-4`;

export const NAME_CRUMB = 'flex min-w-11';
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
  imports: [HlmBreadcrumbImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <nav hlmBreadcrumb aria-label="Breadcrumb">
      <ol hlmBreadcrumbList class="flex-nowrap gap-x-1.5 whitespace-nowrap">
        @for (crumb of crumbs(); track crumb.path) {
          @if (!$first) {
            <li hlmBreadcrumbSeparator class="shrink-0"></li>
          }
          <li hlmBreadcrumbItem [class]="crumb.fixedLabel ? fixedLabelCrumb : nameCrumb">
            <a hlmBreadcrumbLink [link]="crumb.path" [class]="crumbLink"
              ><span class="truncate">{{ crumb.label }}</span></a
            >
          </li>
        }
        <li hlmBreadcrumbSeparator class="shrink-0"></li>
        <li hlmBreadcrumbItem class="flex min-w-16 shrink-100">
          <a hlmBreadcrumbPage [link]="currentPath()" [class]="crumbLink"
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
