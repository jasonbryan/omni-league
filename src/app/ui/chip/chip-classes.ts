// Windows contrast themes replace fill and border colours, so the current chip also gets an outline
// in a system colour.
const FORCED_COLORS_OUTLINE = 'forced-colors:outline-2 forced-colors:outline-[Highlight]';
const CHECKED_FORCED_COLORS_OUTLINE =
  'peer-checked:forced-colors:outline-2 peer-checked:forced-colors:outline-[Highlight]';

const CHIP =
  'inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap pointer-coarse:h-11';

export function chipLinkClasses(current: boolean): string {
  return current
    ? `${CHIP} border-foreground bg-foreground text-background ${FORCED_COLORS_OUTLINE}`
    : `${CHIP} border-input hover:bg-muted`;
}

// A peer variant only matches a later sibling, so the input comes first in the wrapper.
export const CHIP_CHOICE_WRAPPER_CLASSES = 'relative inline-flex';
export const CHIP_CHOICE_INPUT_CLASSES = 'peer sr-only';
export const CHIP_CHOICE_LABEL_CLASSES = [
  CHIP,
  'cursor-pointer border-input select-none hover:bg-muted',
  'peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-checked:hover:bg-foreground',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
  CHECKED_FORCED_COLORS_OUTLINE,
].join(' ');
