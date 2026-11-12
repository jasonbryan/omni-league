import { expect } from 'vitest';
import { slotsOf } from './helm-slots';

// The alert classes before the alerts moved to helm, kept as the expected values of the checks below.
const BASE =
  "group/alert relative w-full grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)]";
const ROOT = {
  default: `${BASE} bg-card text-card-foreground`,
  destructive: `${BASE} text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90`,
};
const LINKS = '[&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3';
const TITLE = `font-medium group-has-[>ng-icon]/alert:col-start-2 ${LINKS}`;
const DESCRIPTION = `text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 ${LINKS}`;

export type AlertVariant = keyof typeof ROOT;

const tokens = (value: string) => value.split(/\s+/).filter(Boolean).sort();
const sortedClasses = (element: Element) => [...element.classList].sort();

function present(box: Element | null | undefined): Element {
  if (!box) throw new Error('An alert check needs an element, got nothing');
  return box;
}

/** The root's own classes beyond the variant's, such as a margin or the focus ring, are `extra`. */
export function expectAlertClasses(
  box: Element | null | undefined,
  variant: AlertVariant,
  extra = '',
): void {
  const root = present(box);
  expect(sortedClasses(root)).toEqual(tokens(`${ROOT[variant]} ${extra}`));
  const title = root.querySelector('[data-slot="alert-title"]');
  const description = root.querySelector('[data-slot="alert-description"]');
  if (title) expect(sortedClasses(title)).toEqual(tokens(TITLE));
  if (description) expect(sortedClasses(description)).toEqual(tokens(DESCRIPTION));
}

export function expectAlertSlots(box: Element | null | undefined, withDescription = true): void {
  expect(slotsOf(present(box))).toEqual(
    withDescription ? ['alert', 'alert-title', 'alert-description'] : ['alert', 'alert-title'],
  );
}

// The Find error alerts before they moved to helm: they differ from the other error alerts by the changes below.
const FIND_BEFORE =
  "group/alert relative grid w-full gap-0.5 rounded-lg border bg-card px-2.5 py-2 text-start text-sm text-destructive has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)]";
const FIND_ROOT_GAINS =
  'has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 *:data-[slot=alert-description]:text-destructive/90';
const RETRY_LINK =
  'col-start-2 mt-1 inline-flex w-fit items-center rounded-md font-medium text-foreground underline underline-offset-4 pointer-coarse:min-h-11';

/** The root keeps its `max-w-xl`; `extra` is the margin the caller adds. The description's colour turns destructive through the root's descendant rule. */
export function expectFindAlert(box: Element | null | undefined, extra = ''): void {
  const root = present(box);
  expect(root.getAttribute('data-slot')).toBe('alert');
  expect(root.getAttribute('role')).toBe('alert');
  expect(sortedClasses(root)).toEqual(
    tokens(`${FIND_BEFORE} ${FIND_ROOT_GAINS} max-w-xl ${extra}`),
  );
  const title = root.querySelector('[data-slot="alert-title"]');
  const description = root.querySelector('[data-slot="alert-description"]');
  expect(title && sortedClasses(title)).toEqual(tokens(TITLE));
  expect(description && sortedClasses(description)).toEqual(tokens(DESCRIPTION));
  expect(slotsOf(root)).toEqual(['alert', 'alert-title', 'alert-description']);
  expect(sortedClasses(root.querySelector('a')!)).toEqual(tokens(RETRY_LINK));
}
