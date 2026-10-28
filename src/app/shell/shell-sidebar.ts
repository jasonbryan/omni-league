import { Directive, TemplateRef, inject, input } from '@angular/core';

@Directive({ selector: 'ng-template[appShellSidebar]' })
export class ShellSidebar {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
  readonly appShellOrganizationName = input<string>();
}
