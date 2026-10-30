import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Keeps the focused control of a form clear of its sticky footer (WCAG 2.4.11). The scroll margin from
 * `STICKY_FOOTER_CLEARANCE` covers the browser's scroll on focus, but an error that appears under the field
 * just left pushes the newly focused control down after that scroll, so the form's growth is watched too.
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
    if (control.getBoundingClientRect().bottom > footer.getBoundingClientRect().top) {
      control.scrollIntoView({ block: 'nearest' });
    }
  }
}
