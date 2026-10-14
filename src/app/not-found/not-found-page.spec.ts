import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotFoundPage } from './not-found-page';

describe('NotFoundPage', () => {
  it('renders the not-found view in the public layout: top bar and footer, no sidebar', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(NotFoundPage);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.children).toHaveLength(1);
    expect(host.children[0].tagName).toBe('APP-PUBLIC-LAYOUT');
    expect(host.querySelectorAll('header')).toHaveLength(1);
    expect(host.querySelectorAll('footer')).toHaveLength(1);
    expect(host.querySelector('button')).toBeNull();
    expect([...host.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label'))).toEqual([
      'Footer',
    ]);
    const main = host.querySelector('main#main');
    expect(main?.children).toHaveLength(1);
    expect(main?.children[0].tagName).toBe('APP-NOT-FOUND-VIEW');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    // The top bar's own links only: the brand and "Sign in" (#63).
    expect([...host.querySelectorAll('header a')].map((a) => a.textContent.trim())).toEqual([
      'Omni League',
      'Sign in',
    ]);
  });
});
