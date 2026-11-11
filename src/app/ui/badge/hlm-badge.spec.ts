import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HlmBadge } from './hlm-badge';

@Component({
  imports: [HlmBadge],
  template: `<span hlmBadge variant="secondary" class="extra">Captain</span
    ><span hlmBadge>Default</span>`,
})
class Host {}

describe('HlmBadge', () => {
  it('sets the slot, the variant, and the variant’s classes, and keeps the caller’s class', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const [secondary, plain] = [...(fixture.nativeElement as HTMLElement).querySelectorAll('span')];
    expect(secondary?.getAttribute('data-slot')).toBe('badge');
    expect(secondary?.getAttribute('data-variant')).toBe('secondary');
    expect(secondary?.classList).toContain('bg-secondary');
    expect(secondary?.classList).toContain('rounded-4xl');
    expect(secondary?.classList).toContain('extra');
    expect(plain?.getAttribute('data-variant')).toBe('default');
    expect(plain?.classList).toContain('bg-primary');
    expect(plain?.classList).not.toContain('bg-secondary');
  });
});
