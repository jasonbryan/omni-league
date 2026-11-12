import { computed, Directive, input } from '@angular/core';

export type HlmAlertVariant = 'default' | 'destructive';

const BASE =
  "group/alert relative w-full grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)]";

const VARIANTS: Readonly<Record<HlmAlertVariant, string>> = {
  default: 'bg-card text-card-foreground',
  destructive: 'text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90',
};

@Directive({
  selector: 'hlm-alert,[hlmAlert]',
  exportAs: 'hlmAlert',
  host: { 'data-slot': 'alert', '[class]': 'classes()' },
})
export class HlmAlert {
  public readonly variant = input<HlmAlertVariant>('default');

  protected readonly classes = computed(() => `${BASE} ${VARIANTS[this.variant()]}`);
}
