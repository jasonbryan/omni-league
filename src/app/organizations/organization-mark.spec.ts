import { TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';
import { OrganizationMark, type MarkSize } from './organization-mark';

const LOGO = 'https://example.convex.cloud/api/storage/logo-1';

function render(name: string, logoUrl?: string, size?: MarkSize) {
  const fixture = TestBed.createComponent(OrganizationMark);
  fixture.componentRef.setInput('name', name);
  if (logoUrl !== undefined) fixture.componentRef.setInput('logoUrl', logoUrl);
  if (size !== undefined) fixture.componentRef.setInput('size', size);
  fixture.detectChanges();
  return { fixture, mark: fixture.nativeElement as HTMLElement };
}

const image = (mark: HTMLElement) => mark.querySelector('img');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrganizationMark', () => {
  it('shows the initials of the first two words, hidden from screen readers', () => {
    const { mark } = render('Gulf Coast Sport & Social');
    expect(mark.textContent.trim()).toBe('GC');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(image(mark)).toBeNull();
  });

  it('shows one letter for a one-word name', () => {
    expect(render('Lakeshore').mark.textContent.trim()).toBe('L');
  });

  describe('with a logo', () => {
    it('shows it as a decorative image with its width and height, and no initials', () => {
      const { mark } = render('Gulf Coast Sport & Social', LOGO);
      const img = image(mark)!;
      expect(img.getAttribute('src')).toBe(LOGO);
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('width')).toBe('48');
      expect(img.getAttribute('height')).toBe('48');
      expect(img.className).toContain('object-cover');
      expect(mark.textContent.trim()).toBe('');
      expect(mark.getAttribute('aria-hidden')).toBe('true');
    });

    it('is 32px on phones and 48px from 768px by default', () => {
      const { mark } = render('Gulf Coast Sport & Social', LOGO);
      expect(mark.classList).toContain('size-8');
      expect(mark.classList).toContain('md:size-12');
    });

    it('is 44px in a list row, and 48px as the preview', () => {
      const row = render('Gulf Coast Sport & Social', LOGO, 'row').mark;
      expect(row.classList).toContain('size-11');
      expect(image(row)!.getAttribute('width')).toBe('44');
      const preview = render('Gulf Coast Sport & Social', LOGO, 'preview').mark;
      expect(preview.classList).toContain('size-12');
      expect(preview.classList).not.toContain('size-8');
    });

    it('shows the initials when the image fails to load', () => {
      const { fixture, mark } = render('Gulf Coast Sport & Social', LOGO);
      image(mark)!.dispatchEvent(new Event('error'));
      fixture.detectChanges();
      expect(image(mark)).toBeNull();
      expect(mark.textContent.trim()).toBe('GC');
      expect(mark.classList).toContain('bg-accent');
    });

    it('shows the initials when the image had already failed before the page took over', () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
      const { fixture, mark } = render('Gulf Coast Sport & Social', LOGO);
      fixture.detectChanges();
      expect(image(mark)).toBeNull();
      expect(mark.textContent.trim()).toBe('GC');
    });

    it('tries a new URL after a failure', () => {
      const { fixture, mark } = render('Gulf Coast Sport & Social', LOGO);
      image(mark)!.dispatchEvent(new Event('error'));
      fixture.detectChanges();
      fixture.componentRef.setInput('logoUrl', `${LOGO}-2`);
      fixture.detectChanges();
      expect(image(mark)?.getAttribute('src')).toBe(`${LOGO}-2`);
    });

    it('shows the initials when the logo is removed', () => {
      const { fixture, mark } = render('Gulf Coast Sport & Social', LOGO);
      fixture.componentRef.setInput('logoUrl', undefined);
      fixture.detectChanges();
      expect(image(mark)).toBeNull();
      expect(mark.textContent.trim()).toBe('GC');
    });
  });
});
