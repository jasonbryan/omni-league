import { linkedSignal, type Signal, type WritableSignal } from '@angular/core';

/**
 * When a field shows its client-side error (ux.md, Task flows, Validation; #205). One instance per
 * field, shared by every form so the rule is the same everywhere:
 *
 * - the field is checked when the user leaves it (`left()`), but only if they changed it, so
 *   tabbing through an untouched field shows nothing;
 * - once shown, the error stays while the value is invalid and clears on the keystroke that makes
 *   it valid; it does not come back on the next keystroke, only after the user leaves the field
 *   again;
 * - a submit (`submitted()`) shows the error of every invalid field and hides the others.
 *
 * Each form keeps its own rules and messages: it passes `invalid` (the field has a client-side
 * error, whether or not it is shown) and `changed` (the user has changed the value).
 */
export class ShownUntilValid {
  private readonly state: WritableSignal<boolean>;

  /** Whether the field's error shows now. */
  readonly shown: Signal<boolean>;

  constructor(
    private readonly invalid: () => boolean,
    private readonly changed: () => boolean,
  ) {
    this.state = linkedSignal<boolean, boolean>({
      source: () => !this.invalid(),
      computation: (valid, previous) => !valid && (previous?.value ?? false),
    });
    this.shown = this.state.asReadonly();
  }

  /** Focus left the field: its error shows if the user changed it and it is invalid. */
  left(): void {
    if (this.invalid() && this.changed()) this.state.set(true);
  }

  /** A submit: the error shows if the field is invalid, whether or not the user touched it. */
  submitted(): void {
    this.state.set(this.invalid());
  }
}

/**
 * True from the first change of `value` on, until it is set back to false (a form clears it when
 * it empties its fields). For a field the signal form does not hold, such as a group of
 * checkboxes; a text field uses the signal form's own `dirty()`, which only the user's typing sets.
 */
export function changedSince(value: () => unknown): WritableSignal<boolean> {
  const changed = linkedSignal<unknown, boolean>({
    source: value,
    computation: (_value, previous) => previous !== undefined,
  });
  // A linked signal computes on first read. Read it now, so the first value it sees is the
  // initial one and every later change counts.
  changed();
  return changed;
}

/**
 * For a `focusout` on a group of controls (checkboxes): true when focus left the group, false when
 * it moved to another control inside it, so a group is checked once the user is done with it.
 */
export function focusLeftGroup(event: FocusEvent): boolean {
  const group = event.currentTarget as Node;
  const next = event.relatedTarget;
  return !(next instanceof Node && group.contains(next));
}
