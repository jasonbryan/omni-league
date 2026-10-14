import { signal } from '@angular/core';
import { changedSince, focusLeftGroup, ShownUntilValid } from './shown-errors';

// ux.md, Task flows, Validation (#205): a field is checked when the user leaves it after changing
// it, re-checked as they type until it is valid, never on the first keystroke; a submit checks it
// regardless.

describe('ShownUntilValid', () => {
  function setup() {
    const value = signal('');
    const changed = changedSince(() => value());
    const check = new ShownUntilValid(
      () => value().length < 3,
      () => changed(),
    );
    return { value, changed, check };
  }

  it('shows nothing while the user types an invalid partial value', () => {
    const { value, check } = setup();
    value.set('a');
    expect(check.shown()).toBe(false);
  });

  it('shows the error once focus leaves a field whose value changed', () => {
    const { value, check } = setup();
    value.set('a');
    check.left();
    expect(check.shown()).toBe(true);
  });

  it('shows nothing when focus passes through a field that never changed', () => {
    const { check } = setup();
    check.left();
    expect(check.shown()).toBe(false);
  });

  it('shows nothing when a changed field is valid as focus leaves it', () => {
    const { value, check } = setup();
    value.set('abc');
    check.left();
    expect(check.shown()).toBe(false);
  });

  it('keeps showing while the user types an invalid value, and clears on the valid keystroke', () => {
    const { value, check } = setup();
    value.set('a');
    check.left();
    value.set('ab');
    expect(check.shown()).toBe(true);
    value.set('abc');
    expect(check.shown()).toBe(false);
  });

  it('does not show again on the keystroke that makes it invalid again, only after leaving', () => {
    const { value, check } = setup();
    value.set('a');
    check.left();
    value.set('abc');
    expect(check.shown()).toBe(false);
    value.set('ab');
    expect(check.shown()).toBe(false);
    check.left();
    expect(check.shown()).toBe(true);
  });

  it('a submit shows an invalid field that was never changed, and hides a valid one', () => {
    const { value, check } = setup();
    check.submitted();
    expect(check.shown()).toBe(true);
    value.set('abc');
    expect(check.shown()).toBe(false);
    check.submitted();
    expect(check.shown()).toBe(false);
  });
});

describe('changedSince', () => {
  it('is false until the value changes, and can be reset', () => {
    const value = signal('a');
    const changed = changedSince(() => value());
    expect(changed()).toBe(false);
    value.set('b');
    expect(changed()).toBe(true);
    changed.set(false);
    expect(changed()).toBe(false);
    value.set('c');
    expect(changed()).toBe(true);
  });
});

describe('focusLeftGroup', () => {
  /** What `focusLeftGroup` says for a `focusout` from `from` to `to`, as the group's handler sees it. */
  function leftGroup(from: HTMLElement, to: HTMLElement | null, root: HTMLElement): boolean {
    let left: boolean | null = null;
    root.addEventListener('focusout', (e) => (left = focusLeftGroup(e)), {
      once: true,
    });
    from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
    return left!;
  }

  it('is false while focus moves within the group, true when it leaves it or the page', () => {
    const root = document.createElement('div');
    const first = document.createElement('button');
    const second = document.createElement('button');
    const outside = document.createElement('button');
    root.append(first, second);
    document.body.append(root, outside);

    expect(leftGroup(first, second, root)).toBe(false);
    expect(leftGroup(second, outside, root)).toBe(true);
    expect(leftGroup(second, null, root)).toBe(true);

    root.remove();
    outside.remove();
  });
});
