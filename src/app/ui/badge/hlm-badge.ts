import { computed, Directive, input } from '@angular/core';

export type HlmBadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost'
  | 'link'
  | 'outline-destructive'
  | 'outline-muted'
  | 'muted';

export type HlmBadgeSize = 'default' | 'fit';

const BASE =
  'group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none gap-1 rounded-4xl border px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)]';

const SIZES: Readonly<Record<HlmBadgeSize, string>> = {
  default: 'h-5',
  fit: '',
};

const VARIANTS: Readonly<Record<HlmBadgeVariant, string>> = {
  default: 'border-transparent bg-primary text-primary-foreground [a]:hover:bg-primary/80',
  secondary: 'border-transparent bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
  destructive:
    'border-transparent bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20',
  outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
  ghost: 'border-transparent hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
  link: 'border-transparent text-primary underline-offset-4 hover:underline',
  'outline-destructive': 'border-border text-destructive',
  'outline-muted':
    'border-border bg-muted text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
  muted: 'border-transparent bg-muted text-muted-foreground',
};

// Vendored from spartan helm 1.9.0 (Nova style). Local changes, to keep when re-copying from upstream:
// - the Nova style's classes are inlined in place of its `spartan-badge-*` names, and a static class
//   per variant replaces `cva()` and `classes()`.
// - `border-transparent` leaves the base and sits in the variants that fill the badge, because with no
//   `tailwind-merge` the built CSS emits `.border-transparent` after `.border-border` and would erase
//   an outline variant's border. Upstream resolves the clash through `tailwind-merge`.
// - the `outline-destructive`, `outline-muted`, and `muted` variants keep the app's badge colours.
// - a `size` input: `default` is helm's `h-5`, and `fit` sets no height, so the text, `py-0.5`, and the
//   border make it 22px, the height the public pages draw.
@Directive({
  selector: '[hlmBadge],hlm-badge',
  exportAs: 'hlmBadge',
  host: { 'data-slot': 'badge', '[attr.data-variant]': 'variant()', '[class]': 'classes()' },
})
export class HlmBadge {
  public readonly variant = input<HlmBadgeVariant>('default');
  public readonly size = input<HlmBadgeSize>('default');

  protected readonly classes = computed(() =>
    [BASE, SIZES[this.size()], VARIANTS[this.variant()]].filter(Boolean).join(' '),
  );
}
