import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { initials } from './initials';

@Component({
  selector: 'app-organization-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    class:
      'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-accent-foreground md:mt-0 md:size-12 md:rounded-xl md:text-base',
  },
  template: `{{ initials() }}`,
})
export class OrganizationMark {
  readonly name = input.required<string>();

  protected readonly initials = computed(() => initials(this.name()));
}
