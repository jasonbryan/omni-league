import { Directive, ElementRef, inject } from '@angular/core';

/**
 * WebKit scrolls a focused text field only far enough to show its caret, so a multi-line field
 * Tabbed to from above shows its first line at the window's bottom edge and the rest below it.
 */
@Directive({
  selector: '[appRevealOnFocus]',
  host: { '(focus)': 'reveal()' },
})
export class RevealOnFocus {
  private readonly field = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected reveal(): void {
    this.field.scrollIntoView({ block: 'nearest' });
  }
}
