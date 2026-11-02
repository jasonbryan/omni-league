import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MousePressKeepsFocus } from './mouse-press-keeps-focus';

@Component({
  imports: [MousePressKeepsFocus],
  template: `
    <input />
    <button type="submit" appMousePressKeepsFocus>Save</button>
  `,
})
class Host {}

describe('MousePressKeepsFocus', () => {
  let input: HTMLInputElement;
  let button: HTMLButtonElement;

  beforeEach(async () => {
    const fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement as HTMLElement);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    input = root.querySelector('input')!;
    button = root.querySelector('button')!;
    input.focus();
  });

  afterEach(() => document.body.replaceChildren());

  function press(pointerType: string): MouseEvent {
    const pointer = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointer, 'pointerType', { value: pointerType });
    button.dispatchEvent(pointer);
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(mousedown);
    return mousedown;
  }

  const click = (detail = 1) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));

  it('default-prevents a mouse press, so focus stays in the field, and the click focuses the button', () => {
    expect(press('mouse').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    click();
    expect(document.activeElement).toBe(button);
  });

  it('leaves a tap alone: the mousedown is not default-prevented and the click moves no focus', () => {
    expect(press('touch').defaultPrevented).toBe(false);
    click();
    expect(document.activeElement).toBe(input);
  });

  it('never default-prevents a keydown or a click', () => {
    press('mouse');
    const keydown = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(keydown);
    const clicked = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    button.dispatchEvent(clicked);
    expect(keydown.defaultPrevented).toBe(false);
    expect(clicked.defaultPrevented).toBe(false);
  });

  it('moves no focus on a click with no press before it, such as Enter or Space', () => {
    click(0);
    expect(document.activeElement).toBe(input);
  });

  it('does not carry a press released elsewhere over to a later keyboard click', () => {
    press('mouse');
    click(0);
    expect(document.activeElement).toBe(input);
  });
});
