import { Directive } from '@angular/core';

export const TEXTAREA_CLASSES =
  'border-input dark:bg-input/30 data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors data-[matches-spartan-invalid=true]:ring-3 md:text-sm placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full disabled:cursor-not-allowed disabled:opacity-50';

@Directive({
  selector: 'textarea[hlmTextarea]',
  host: { 'data-slot': 'textarea', class: TEXTAREA_CLASSES },
})
export class HlmTextarea {}
