// Vendored from spartan helm v1.9.0 (`libs/helm/radio-group`: radio group, radio, radio indicator), with the indicator's classes
// taken from the staff Role and place free agent Team choices that it replaces, not from the Nova style.
// Local changes, to keep when re-copying from upstream:
// - the indicator keeps today's look: a filled `bg-primary` circle with a `bg-primary-foreground` dot when checked, the `outline-ring`
//   focus ring, and `opacity-50` when disabled, where helm draws a bordered circle with a primary dot. The `group/radio` name is on
//   the `brn-radio` that holds the input, so a group of another kind around the radios does not match;
// - the invalid edge (`border-destructive`) comes from an `invalid` input on the group that the consumer sets, because `BrnRadioGroup`
//   binds `aria-invalid` and `data-invalid` on its host from an `NgControl`, and a consumer binding on the same element would race it;
// - the group binds through `[value]` and `(valueChange)`. Brain's `ControlValueAccessor` is provided by the directive and not used;
// - no `BrnFieldControlDescribedBy`, and no `aria-invalid`, `data-invalid`, `data-dirty`, `data-touched`, or
//   `data-matches-spartan-invalid` on the group or the radio, for the reason given in `src/app/ui/input`: the page sets the
//   description and the error itself;
// - the radio does not set `data-disabled` on the label that names it: the page dims the label through its field;
// - `inputStyles` makes the native input cover its indicator with no opacity, where brn hides it in 1px, so a tap or a focus lands on the
//   indicator and the focus ring around it shows;
// - static classes, so a chunk that uses them carries no class-merging code: the radio sets `shrink-0` on its host and its own classes
//   on `brn-radio`, followed by the `class` input, which a consumer binds with `[class]` so the classes are not also left on the host;
// - the group is a grid with a `gap-3` in place of `gap-2`, which is today's spacing between the rows.
import { HlmRadio } from './hlm-radio';
import { HlmRadioGroup } from './hlm-radio-group';
import { HlmRadioIndicator } from './hlm-radio-indicator';

export * from './hlm-radio';
export * from './hlm-radio-group';
export * from './hlm-radio-indicator';

export const HlmRadioGroupImports = [HlmRadioGroup, HlmRadio, HlmRadioIndicator] as const;
