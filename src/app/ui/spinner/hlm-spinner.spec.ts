import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { lucideLoaderCircle } from '@ng-icons/lucide';
import { HlmSpinnerImports } from '.';

@Component({
  imports: [HlmSpinnerImports],
  template: `
    <button type="button" aria-disabled="true">
      <hlm-spinner data-icon="inline-start" />Saving…
    </button>
  `,
})
class PendingButton {}

const paths = (svg: Element | null) =>
  [...(svg?.querySelectorAll('path') ?? [])].map((shape) => shape.getAttribute('d'));

describe('HlmSpinner', () => {
  let button: HTMLElement;
  let spinner: HTMLElement;

  beforeEach(async () => {
    const fixture = TestBed.createComponent(PendingButton);
    await fixture.whenStable();
    button = fixture.nativeElement.querySelector('button');
    spinner = button.querySelector('hlm-spinner')!;
  });

  it('is hidden from assistive technology, so the button label is the only announcement', () => {
    expect(spinner.getAttribute('aria-hidden')).toBe('true');
    expect(spinner.hasAttribute('role')).toBe(false);
    expect(spinner.hasAttribute('aria-label')).toBe(false);
    expect(button.querySelector('[role="status"]')).toBeNull();
    expect(button.textContent!.trim()).toBe('Saving…');
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('is 16px and spins only when the person has not asked for reduced motion', () => {
    const tokens = spinner.getAttribute('class')!.split(/\s+/).filter(Boolean).sort();
    expect(tokens).toEqual(['inline-flex', 'motion-safe:animate-spin', 'text-base'].sort());
    expect(tokens.filter((token) => /(^|:)animate-/.test(token))).toEqual([
      'motion-safe:animate-spin',
    ]);
  });

  it('keeps the slot', () => {
    expect(spinner.getAttribute('data-slot')).toBe('spinner');
  });

  it('draws the Lucide loader circle', () => {
    const icon = spinner.querySelector('ng-icon')!;
    expect(icon.getAttribute('name')).toBe('lucideLoaderCircle');
    const expected = paths(
      new DOMParser().parseFromString(lucideLoaderCircle, 'image/svg+xml').querySelector('svg'),
    );
    expect(paths(icon.querySelector('svg'))).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});
