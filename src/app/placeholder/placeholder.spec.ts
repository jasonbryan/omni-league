import { TestBed } from '@angular/core/testing';
import { Placeholder } from './placeholder';

describe('Placeholder', () => {
  it('renders a main landmark holding a single h1 reading "Omni League" and nothing else', async () => {
    const fixture = TestBed.createComponent(Placeholder);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.children).toHaveLength(1);
    const main = host.children[0];
    expect(main.tagName).toBe('MAIN');
    expect(main.children).toHaveLength(1);
    expect(main.children[0].tagName).toBe('H1');
    expect(main.children[0].textContent).toBe('Omni League');
  });

  // The approved placeholder is the `home` state of design/mockups/61-token-sheet.html (#61).
  it('uses the classes of the approved mockup state', async () => {
    const fixture = TestBed.createComponent(Placeholder);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('main')?.className.split(/\s+/).sort()).toEqual(
      ['mx-auto', 'max-w-5xl', 'px-4', 'py-10', 'md:px-8', 'md:py-14'].sort(),
    );
    expect(host.querySelector('h1')?.className.split(/\s+/).sort()).toEqual(
      ['text-2xl', 'font-semibold', 'tracking-tight', 'md:text-3xl'].sort(),
    );
  });
});
