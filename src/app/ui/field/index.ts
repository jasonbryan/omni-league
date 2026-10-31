// Vendored from spartan helm 1.6.0 (`libs/helm/field`: field, field group, field label, field description, field error), with the
// Nova style's classes inlined in place of its `spartan-field-*` names.
// Local changes, to keep when re-copying from upstream:
// - no `BrnField`, `BrnLabel`, or `BrnFieldA11yService`: the page sets each element's `id`, the control's `aria-describedby`, and
//   the field's `data-matches-spartan-invalid`, for the reason given in `src/app/ui/input`;
// - the field is vertical only, the one orientation the pages use;
// - the field error is a directive with `role="alert"`, which the page renders only while the error shows, in place of helm's
//   component that decides that from the form control;
// - static classes, so a chunk that uses them carries no class-merging code.
import {
  HlmField,
  HlmFieldDescription,
  HlmFieldError,
  HlmFieldGroup,
  HlmFieldLabel,
} from './hlm-field';

export * from './hlm-field';

export const HlmFieldImports = [
  HlmField,
  HlmFieldDescription,
  HlmFieldError,
  HlmFieldGroup,
  HlmFieldLabel,
] as const;
