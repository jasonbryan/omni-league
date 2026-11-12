// Windows contrast themes replace fill and border colours, so the current chip is a Highlight fill,
// and the focus ring is a separate outline in a system colour: an outline for both would not show focus.
const FORCED_COLORS_FILL =
  'forced-colors:forced-color-adjust-none forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const FORCED_COLORS_LINK_FOCUS = 'forced-colors:focus-visible:outline-[CanvasText]';
const FORCED_COLORS_CHECKED_FILL =
  'peer-checked:forced-colors:forced-color-adjust-none peer-checked:forced-colors:bg-[Highlight] peer-checked:forced-colors:text-[HighlightText]';
const FORCED_COLORS_CHOICE_FOCUS = 'peer-focus-visible:forced-colors:outline-[CanvasText]';

// WebKit gives a radio that an arrow key focuses no :focus-visible, and never focuses a radio on a
// click or tap, so there :focus is keyboard focus. Only WebKit supports -webkit-backdrop-filter.
const WEBKIT_CHOICE_FOCUS =
  'supports-[-webkit-backdrop-filter:none]:peer-focus:outline-2 supports-[-webkit-backdrop-filter:none]:peer-focus:outline-offset-2 supports-[-webkit-backdrop-filter:none]:peer-focus:outline-ring';

const WEBKIT_RADIO_CHIP_FOCUS =
  'supports-[-webkit-backdrop-filter:none]:has-[input:focus]:outline-2 supports-[-webkit-backdrop-filter:none]:has-[input:focus]:outline-offset-2 supports-[-webkit-backdrop-filter:none]:has-[input:focus]:outline-ring';

const CHIP_SHAPE =
  'inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center';
const CHIP = `${CHIP_SHAPE} gap-2`;

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
  WEBKIT_CHOICE_FOCUS,
  FORCED_COLORS_CHECKED_FILL,
  FORCED_COLORS_CHOICE_FOCUS,
].join(' ');

// The chip drawn by the radio group's `brn-radio`, which holds the native input. Brain binds `data-checked="false"` on an
// unchecked radio, so the filled chip is `data-[checked=true]:`: a bare `data-checked:` would fill every chip.
// The helm radio class string comes first and there is no class merging, so the important margin and `w-auto` undo its top margin
// and 1rem width (a plain margin utility sorts before the one it must beat), and the data variant beats its has-checked fill by
// coming later in the stylesheet. The ring on keyboard focus comes from that string too; this adds the WebKit and forced-colours cases.
export const RADIO_CHIP_CLASSES = [
  CHIP_SHAPE,
  'mt-0! w-auto cursor-pointer select-none not-data-[checked=true]:hover:bg-muted',
  'data-[checked=true]:border-foreground data-[checked=true]:bg-foreground data-[checked=true]:text-background',
  WEBKIT_RADIO_CHIP_FOCUS,
  'data-[checked=true]:forced-colors:forced-color-adjust-none data-[checked=true]:forced-colors:bg-[Highlight] data-[checked=true]:forced-colors:text-[HighlightText]',
  'has-[input:focus-visible]:forced-colors:outline-[CanvasText]',
].join(' ');
