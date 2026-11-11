// Vendored from spartan helm v1.9.0 (`libs/helm/field`: field, field content, field group, field label, field description, field
// error), with the Nova style's classes (`libs/registry/src/styles/style-nova.css`) inlined in place of its `spartan-field-*` names.
// Local changes, to keep when re-copying from upstream:
// - no `BrnField`, `BrnLabel`, or `BrnFieldA11yService`: the page sets each element's `id`, the control's `aria-describedby`, and
//   the field's `data-matches-spartan-invalid`, for the reason given in `src/app/ui/input`;
// - the field has the `vertical` and `horizontal` orientations and no `responsive` one, which no page uses;
// - the field label has no `HlmLabel` host directive: its one static string is the merge of `HlmLabel` and the field label, so
//   its line height is one class where static strings from the two would carry both and `classes()` would resolve them;
// - the field description keeps no `id` input and no registration with `BrnFieldA11yService`;
// - the field error is a directive with `role="alert"` that the page renders only while the error shows, in place of helm's
//   component that decides that from the form control, and it adds `flex items-start gap-1.5` for the icon beside its text;
// - static classes, so a chunk that uses them carries no class-merging code: the field picks one of two strings by orientation.
// - attribute selectors only (no `hlm-field*` element selectors) and no `exportAs`; the field label matches `label` elements only.
import {
  HlmField,
  HlmFieldContent,
  HlmFieldDescription,
  HlmFieldError,
  HlmFieldGroup,
  HlmFieldLabel,
} from './hlm-field';

export * from './hlm-field';

export const HlmFieldImports = [
  HlmField,
  HlmFieldContent,
  HlmFieldDescription,
  HlmFieldError,
  HlmFieldGroup,
  HlmFieldLabel,
] as const;
