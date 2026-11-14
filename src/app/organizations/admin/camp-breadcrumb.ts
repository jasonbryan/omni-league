import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Role } from '../../../../convex/lib/roles';
import { HlmBreadcrumbImports } from '../../ui/breadcrumb';
import { CRUMB_LINK, NAME_CRUMB } from '../league/league-breadcrumb';
import { adminPath } from './admin-path';
import { campPath } from './camp-path';

interface Crumb {
  label: string;
  path: string;
  fixedLabel: boolean;
}

/**
 * A league organizer who is not an org admin is sent to `/app`, because the admin area shows them the no-access view.
 * The trail stays on one line so its height is known before the camp loads, which keeps the h1 where the skeleton drew it.
 */
@Component({
  selector: 'app-camp-breadcrumb',
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
          <li hlmBreadcrumbItem [class]="crumb.fixedLabel ? 'flex shrink-0' : nameCrumb">
            <a hlmBreadcrumbLink [link]="crumb.path" [class]="crumbLink"
              ><span class="truncate">{{ crumb.label }}</span></a
            >
          </li>
        }
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
export class CampBreadcrumb {
  readonly role = input.required<Role>();
  readonly organizationName = input.required<string>();
  readonly organizationSlug = input.required<string>();
  readonly name = input.required<string>();
  readonly slug = input.required<string>();

  protected readonly crumbLink = CRUMB_LINK;
  protected readonly nameCrumb = NAME_CRUMB;

  protected readonly crumbs = computed<Crumb[]>(() => {
    if (this.role() !== 'orgAdmin') {
      return [{ label: 'Your organizations', path: '/app', fixedLabel: true }];
    }
    const slug = this.organizationSlug();
    return [
      { label: this.organizationName(), path: adminPath(slug), fixedLabel: false },
      { label: 'Camps', path: adminPath(slug, 'camps'), fixedLabel: true },
    ];
  });

  protected readonly currentPath = computed(() => campPath(this.organizationSlug(), this.slug()));
}
