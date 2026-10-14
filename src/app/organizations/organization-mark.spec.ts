import { TestBed } from '@angular/core/testing';
import { OrganizationMark } from './organization-mark';

function render(name: string): HTMLElement {
  const fixture = TestBed.createComponent(OrganizationMark);
  fixture.componentRef.setInput('name', name);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('OrganizationMark', () => {
  it('shows the initials of the first two words, hidden from screen readers', () => {
    const mark = render('Gulf Coast Sport & Social');
    expect(mark.textContent.trim()).toBe('GC');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows one letter for a one-word name', () => {
    expect(render('Lakeshore').textContent.trim()).toBe('L');
  });

  it('is 32px square on phones and 48px from 768px', () => {
    const mark = render('Gulf Coast');
    expect(mark.classList.contains('size-8')).toBe(true);
    expect(mark.classList.contains('md:size-12')).toBe(true);
    expect(mark.classList.contains('shrink-0')).toBe(true);
  });
});
