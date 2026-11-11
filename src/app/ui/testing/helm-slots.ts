export function slotsOf(root: Element | null | undefined): string[] {
  if (!root) throw new Error('slotsOf needs an element, got nothing');
  return [root, ...root.querySelectorAll('[data-slot]')]
    .map((element) => element.getAttribute('data-slot'))
    .filter((slot): slot is string => slot !== null);
}
