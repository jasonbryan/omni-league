import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Placeholder } from './placeholder';

describe('Placeholder', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('renders in the app shell, top bar only, with a single h1 reading "Omni League" in main', async () => {
    const fixture = TestBed.createComponent(Placeholder);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.children).toHaveLength(1);
    expect(host.children[0].tagName).toBe('APP-SHELL');
    expect(host.querySelectorAll('header')).toHaveLength(1);
    expect(host.querySelector('button')).toBeNull();
    const main = host.querySelector('main#main');
    expect(main?.children).toHaveLength(1);
    const column = main?.children[0];
    expect(column?.tagName).toBe('DIV');
    expect(column?.children).toHaveLength(1);
    expect(column?.children[0].tagName).toBe('H1');
    expect(column?.children[0].textContent).toBe('Omni League');
  });

  it('uses the classes of the approved mockup state', async () => {
    const fixture = TestBed.createComponent(Placeholder);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('main > div')?.className.split(/\s+/).sort()).toEqual(
      ['mx-auto', 'w-full', 'max-w-5xl', 'px-4', 'py-6', 'md:px-8', 'md:py-8'].sort(),
    );
    expect(host.querySelector('h1')?.className.split(/\s+/).sort()).toEqual(
      ['text-2xl', 'font-semibold', 'tracking-tight', 'md:text-3xl'].sort(),
    );
  });
});
