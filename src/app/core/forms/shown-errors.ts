import { linkedSignal, type Signal, type WritableSignal } from '@angular/core';

export class ShownUntilValid {
  private readonly state: WritableSignal<boolean>;

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

  left(): void {
    if (this.invalid() && this.changed()) this.state.set(true);
  }

  submitted(): void {
    this.state.set(this.invalid());
  }
}

/** For a field the signal form does not hold, such as a group of checkboxes; a text field uses the signal form's own `dirty()`, which only the user's typing sets. */
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

export function focusLeftGroup(event: FocusEvent): boolean {
  const group = event.currentTarget as Node;
  const next = event.relatedTarget;
  return !(next instanceof Node && group.contains(next));
}
