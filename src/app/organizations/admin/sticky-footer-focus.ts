import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Space left between the focused control and the top of the sticky footer. */
export const GAP_ABOVE_FOOTER_PX = 16;

/**
 * Keeps the focused control of a form above its sticky footer (WCAG 2.4.11), whether the user Tabs to
 * it or the form focuses it. The browser's focus scroll can leave it under the footer: an error under
 * the field just left pushes it down afterwards, an element without `STICKY_FOOTER_CLEARANCE`'s scroll
 * margin scrolls only to the viewport edge, and one behind the footer counts as in view and stays.
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
    const overlap = shown.getBoundingClientRect().bottom - footer.getBoundingClientRect().top;
    if (overlap > 0) window.scrollBy({ top: overlap + GAP_ABOVE_FOOTER_PX, behavior: 'instant' });
  }
}
