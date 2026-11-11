import { computed, effect, signal, type Signal } from '@angular/core';
import type { FunctionArgs, FunctionReference } from 'convex/server';
import { isChoosableSlug } from '../../../../convex/lib/slugs';
import { injectQuery, skipToken } from '../data/convex';

export const AVAILABILITY_PAUSE_MS = 400;

export type SlugAnswer = 'available' | 'taken' | null;

export interface WebAddressCheck {
  readonly answer: Signal<SlugAnswer>;
  left(): void;
}

export const NOT_CHECKED: WebAddressCheck = {
  answer: signal<SlugAnswer>(null),
  left: () => undefined,
};

interface SlugAvailabilityOptions<Q extends FunctionReference<'query'>> {
  query: Q;
  slug: () => string;
  scope: () => Omit<FunctionArgs<Q>, 'slug'> | null;
}

export function injectSlugAvailability<Q extends FunctionReference<'query'>>(
  options: SlugAvailabilityOptions<Q>,
): WebAddressCheck {
  const asked = signal('');

  effect((onCleanup) => {
    const value = options.slug();
    const timer = setTimeout(() => asked.set(value), AVAILABILITY_PAUSE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  const result = injectQuery(options.query, () => {
    const value = asked();
    if (!isChoosableSlug(value)) return skipToken;
    const scope = options.scope();
    if (scope === null) return skipToken;
    return { ...scope, slug: value };
  });

  const answer = computed<SlugAnswer>(() => {
    if (asked() !== options.slug()) return null;
    const available = result.value();
    if (available === undefined) return null;
    return available ? 'available' : 'taken';
  });

  return { answer, left: () => asked.set(options.slug()) };
}
