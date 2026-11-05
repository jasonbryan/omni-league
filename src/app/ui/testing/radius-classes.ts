const VARIANTS = String.raw`(?:(?:\[[^\]\s]*\]|[^\s:\[\]])+:)*`;
const SIZES = String.raw`none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[[^\]\s]+\]|\([^)\s]+\)`;
const RADIUS_CLASS = new RegExp(`^${VARIANTS}rounded(?:-(?:${SIZES}))?$`);

export function radiusClasses(element: Element | null): string[] {
  if (!element) throw new Error('radiusClasses needs an element, got null');
  return (element.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((token) => RADIUS_CLASS.test(token));
}

export function allRadiusClasses(elements: Iterable<Element>): string[][] {
  return [...elements].map(radiusClasses);
}
