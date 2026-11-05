import { booleanAttribute, Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Pressing a button blurs the focused field, and the error that leaving it shows can move the button
 * before the release, which then lands elsewhere and fires no click. Keeping focus in the field on a
 * mouse press moves nothing; the click then focuses the button, as a click does in Chromium.
 * A tap sends down, up, and click together, so it cannot lose the press and keeps closing the keyboard,
 * unless the button opts in with `appTouchKeepsFocus`. A button in a field group opts in, because WebKit
 * sends a tap's focus to the page rather than the button, which ends the group's focus too early.
 */
@Directive({
  selector: '[appMousePressKeepsFocus]',
  host: {
    '(pointerdown)': 'pointerType = $event.pointerType',
    '(mousedown)': 'keepFocus($event)',
    '(click)': 'focusButton($event)',
  },
})
export class MousePressKeepsFocus {
  readonly appTouchKeepsFocus = input(false, { transform: booleanAttribute });
  private readonly button = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected pointerType = '';
  private kept = false;

  protected keepFocus(event: MouseEvent): void {
    this.kept = this.pointerType === 'mouse' || this.appTouchKeepsFocus();
    if (this.kept) event.preventDefault();
  }

  protected focusButton(event: MouseEvent): void {
    // A keyboard click has no detail, so a press released elsewhere does not carry over to it.
    const afterKeptPress = this.kept && event.detail > 0;
    this.kept = false;
    if (afterKeptPress) this.button.focus();
  }
}
