import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { StickyFooter, STICKY_FOOTER_CLEARANCE } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';

@Component({
  imports: [StickyFooter, StickyFooterFocus],
  template: `
    <form appStickyFooterFocus>
      <input />
      <div appStickyFooter><button type="submit">Save</button></div>
    </form>
  `,
})
class FormWithFocusFix {}

@Component({
  imports: [StickyFooter],
  template: `
    <form>
      <input />
      <div appStickyFooter><button type="submit">Save</button></div>
    </form>
  `,
})
class FormWithoutFocusFix {}

describe('StickyFooter', () => {
  it('sticks to the bottom on phones and sits in the flow from 768px, as the form footer', async () => {
    const fixture = TestBed.createComponent(FormWithFocusFix);
    await fixture.whenStable();
    const footer = fixture.debugElement.query(By.directive(StickyFooter)).nativeElement as Element;
    expect(footer.getAttribute('data-slot')).toBe('form-footer');
    expect([...footer.classList]).toEqual(
      expect.arrayContaining(['sticky', 'bottom-0', 'z-10', 'bg-card', 'md:static', 'md:p-0']),
    );
  });

  it('cannot be used in a form that lacks the focus fix, so no form can leave it out (WCAG 2.4.11)', () => {
    expect(() => TestBed.createComponent(FormWithoutFocusFix)).toThrowError(/StickyFooterFocus/);
  });

  it('gives focused controls a scroll margin as tall as the footer on phones only', () => {
    expect(STICKY_FOOTER_CLEARANCE.split(' ')).toEqual([
      '[&_:is(input,button,select,textarea,a)]:scroll-mb-24',
      'md:[&_:is(input,button,select,textarea,a)]:scroll-mb-0',
    ]);
  });
});
