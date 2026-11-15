import { Directive, TemplateRef, inject } from '@angular/core';

@Directive({ selector: 'ng-template[appShellSidebar]' })
export class ShellSidebar {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}
