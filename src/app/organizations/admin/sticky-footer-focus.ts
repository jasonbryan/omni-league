import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

export const GAP_ABOVE_FOOTER_PX = 16;

/**
 * The browser's focus scroll can leave the focused control under the footer (WCAG 2.4.11): an error
 * under the field just left pushes it down afterwards, an element without `STICKY_FOOTER_CLEARANCE`'s
 * scroll margin scrolls only to the viewport edge, and one behind the footer counts as in view and
 * stays. The fix scrolls the window, the scroller of every page form, so a footer in a scrolling sheet
 * or dialog would not be covered.
 */
@Directive({
  selector: 'form[appStickyFooterFocus]',
  host: { '(focusin)': 'checkAfterFocusScroll()' },
})
export class StickyFooterFocus {
  private readonly form = inject<ElementRef<HTMLFormElement>>(ElementRef).nativeElement;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Every supported browser has ResizeObserver; jsdom (unit tests) does not.
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.keepFocusClear());
      observer.observe(this.form);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected checkAfterFocusScroll(): void {
    requestAnimationFrame(() => this.keepFocusClear());
  }

  private keepFocusClear(): void {
    const control = document.activeElement;
    if (!(control instanceof HTMLElement) || !this.form.contains(control)) return;
    const footer = this.form.querySelector<HTMLElement>('[data-slot="form-footer"]');
    if (!footer || footer.contains(control) || getComputedStyle(footer).position !== 'sticky') {
      return;
    }
    // A chip's radio is visually hidden inside its label, which is what the user sees.
    const shown = control.closest('label') ?? control;
    const shownBottom = shown.getBoundingClientRect().bottom;
    const footerBox = footer.getBoundingClientRect();
    if (shownBottom <= footerBox.top) return;
    // Near the form's top, the form holds the footer below where it sticks; the scroll lifts it.
    const footerTopAfterScroll = Math.min(footerBox.top, window.innerHeight - footerBox.height);
    window.scrollBy({
      top: shownBottom - footerTopAfterScroll + GAP_ABOVE_FOOTER_PX,
      behavior: 'instant',
    });
  }
}
