// The classes that `src/styles.css` leaves out of the production stylesheet because no page can use
// them.
/**
 * @typedef {{ name: string, helmFile: string, classes: string[] }} HelmVariantGroup
 */

/** @type {HelmVariantGroup[]} */
export const HELM_VARIANT_GROUPS = [
  {
    name: 'sheet sides',
    helmFile: 'src/app/ui/sheet/hlm-sheet-content.ts',
    classes: [
      'data-[side=right]:inset-y-0',
      'data-[side=right]:right-0',
      'data-[side=right]:h-full',
      'data-[side=right]:w-3/4',
      'data-[side=right]:border-l',
      'data-[side=top]:inset-x-0',
      'data-[side=top]:top-0',
      'data-[side=top]:h-auto',
      'data-[side=top]:border-b',
      'data-[side=right]:data-open:slide-in-from-right',
      'data-[side=top]:data-open:slide-in-from-top',
      'data-[side=right]:data-closed:slide-out-to-right',
      'data-[side=top]:data-closed:slide-out-to-top',
    ],
  },
  {
    name: 'badge as a control',
    helmFile: 'src/app/ui/badge/hlm-badge.ts',
    classes: [
      '[a]:hover:bg-destructive/20',
      '[a]:hover:bg-muted',
      '[a]:hover:bg-primary/80',
      '[a]:hover:bg-secondary/80',
      '[a]:hover:text-muted-foreground',
      'focus-visible:border-ring',
      'focus-visible:ring-[3px]',
      'focus-visible:ring-ring/50',
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
    ],
  },
  {
    name: 'file input',
    helmFile: 'src/app/ui/input/hlm-input.ts',
    classes: [
      'file:inline-flex',
      'file:h-6',
      'file:border-0',
      'file:bg-transparent',
      'file:text-sm',
      'file:font-medium',
      'file:text-foreground',
    ],
  },
  {
    name: 'small helm buttons',
    helmFile: 'src/app/ui/button/hlm-button.ts',
    classes: [
      'rounded-[min(var(--radius-md),10px)]',
      'rounded-[min(var(--radius-md),12px)]',
      'text-[0.8rem]',
      'in-data-[slot=button-group]:rounded-lg',
      "[&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3)]",
      "[&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3.5)]",
    ],
  },
];

export const HELM_VARIANT_CLASSES = new Set(HELM_VARIANT_GROUPS.flatMap((group) => group.classes));
