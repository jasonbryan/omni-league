import { Directive, TemplateRef, inject, input } from '@angular/core';

/** The page's own sidebar. Without one the shell shows the home sidebar. */
@Directive({ selector: 'ng-template[appShellSidebar]' })
export class ShellSidebar {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
  /** What the slim bar below 1024px names: the page's organization. */
  readonly appShellSidebarTitle = input<string>();
}
