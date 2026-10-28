// Windows contrast themes replace fill and border colours, so the current chip is a Highlight fill,
// and the focus ring is a separate outline in a system colour: an outline for both would not show focus.
const FORCED_COLORS_FILL =
  'forced-colors:forced-color-adjust-none forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const FORCED_COLORS_LINK_FOCUS = 'forced-colors:focus-visible:outline-[CanvasText]';
const FORCED_COLORS_CHECKED_FILL =
  'peer-checked:forced-colors:forced-color-adjust-none peer-checked:forced-colors:bg-[Highlight] peer-checked:forced-colors:text-[HighlightText]';
const FORCED_COLORS_CHOICE_FOCUS = 'peer-focus-visible:forced-colors:outline-[CanvasText]';

const CHIP =
  'inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center';

export function chipLinkClasses(current: boolean): string {
  return current
    ? `${CHIP} border-foreground bg-foreground text-background ${FORCED_COLORS_FILL} ${FORCED_COLORS_LINK_FOCUS}`
    : `${CHIP} border-input hover:bg-muted ${FORCED_COLORS_LINK_FOCUS}`;
}

// A peer variant only matches a later sibling, so the input comes first in the wrapper.
export const CHIP_CHOICE_WRAPPER_CLASSES = 'relative inline-flex';
export const CHIP_CHOICE_INPUT_CLASSES = 'peer sr-only';
export const CHIP_CHOICE_LABEL_CLASSES = [
  CHIP,
  'cursor-pointer border-input select-none not-peer-checked:hover:bg-muted',
  'peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
  FORCED_COLORS_CHECKED_FILL,
  FORCED_COLORS_CHOICE_FOCUS,
].join(' ');
