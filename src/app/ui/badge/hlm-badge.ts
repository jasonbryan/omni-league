import { computed, Directive, input } from '@angular/core';

export type HlmBadgeVariant =
  'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';

const BASE =
  'group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)]';

const VARIANTS: Readonly<Record<HlmBadgeVariant, string>> = {
  default: `${BASE} bg-primary text-primary-foreground [a]:hover:bg-primary/80`,
  secondary: `${BASE} bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80`,
  destructive: `${BASE} bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20`,
  outline: `${BASE} border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground`,
  ghost: `${BASE} hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50`,
  link: `${BASE} text-primary underline-offset-4 hover:underline`,
};

// Vendored from spartan helm 1.9.0 (Nova style). Local changes, to keep when re-copying from upstream:
// - the Nova style's classes are inlined in place of its `spartan-badge-*` names, and a static class
//   per variant replaces `cva()` and `classes()`.
@Directive({
  selector: '[hlmBadge],hlm-badge',
  exportAs: 'hlmBadge',
  host: { 'data-slot': 'badge', '[attr.data-variant]': 'variant()', '[class]': 'classes()' },
})
export class HlmBadge {
  public readonly variant = input<HlmBadgeVariant>('default');

  protected readonly classes = computed(() => VARIANTS[this.variant()]);
}
