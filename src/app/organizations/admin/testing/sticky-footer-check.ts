import { expect } from 'vitest';
import type { DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { StickyFooter } from '../sticky-footer';
import { StickyFooterFocus } from '../sticky-footer-focus';

/** The form keeps its focused control above the footer, and its footer is the shared sticky one. */
export function expectStickyFooterWithFocusFix(root: DebugElement, form: HTMLFormElement): void {
  const on = (directive: typeof StickyFooter | typeof StickyFooterFocus) =>
    root.queryAll(By.directive(directive)).map((found) => found.nativeElement as Element);
  expect(on(StickyFooterFocus)).toContain(form);
  expect(on(StickyFooter)).toContain(form.querySelector('[data-slot="form-footer"]'));
}
