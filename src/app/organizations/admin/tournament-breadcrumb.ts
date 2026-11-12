import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { HlmBreadcrumbImports } from '../../ui/breadcrumb';
import { CRUMB_LINK, NAME_CRUMB } from '../league/league-breadcrumb';
import { adminPath } from './admin-path';
import { tournamentPath } from './tournament-path';

/** The trail stays on one line so its height is known before the tournament loads, which keeps the h1 where the skeleton drew it. */
@Component({
  selector: 'app-tournament-breadcrumb',
  imports: [HlmBreadcrumbImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <nav hlmBreadcrumb aria-label="Breadcrumb">
      <ol hlmBreadcrumbList class="flex-nowrap gap-x-1.5 whitespace-nowrap">
        <li hlmBreadcrumbItem [class]="nameCrumb">
          <a hlmBreadcrumbLink [link]="organizationPath()" [class]="crumbLink"
            ><span class="truncate">{{ organizationName() }}</span></a
          >
        </li>
        <li hlmBreadcrumbSeparator class="shrink-0"></li>
        <li hlmBreadcrumbItem class="flex shrink-0">
          <a hlmBreadcrumbLink [link]="tournamentsPath()" [class]="crumbLink">Tournaments</a>
        </li>
        <li hlmBreadcrumbSeparator class="shrink-0"></li>
        <li hlmBreadcrumbItem class="flex min-w-16 shrink-100">
          <a hlmBreadcrumbPage [link]="currentPath()" [class]="crumbLink"
            ><span class="truncate">{{ name() }}</span></a
          >
        </li>
      </ol>
    </nav>
  `,
})
export class TournamentBreadcrumb {
  readonly organizationName = input.required<string>();
  readonly organizationSlug = input.required<string>();
  readonly name = input.required<string>();
  readonly slug = input.required<string>();

  protected readonly crumbLink = CRUMB_LINK;
  protected readonly nameCrumb = NAME_CRUMB;

  protected readonly organizationPath = computed(() => adminPath(this.organizationSlug()));
  protected readonly tournamentsPath = computed(() =>
    adminPath(this.organizationSlug(), 'tournaments'),
  );
  protected readonly currentPath = computed(() =>
    tournamentPath(this.organizationSlug(), this.slug()),
  );
}
