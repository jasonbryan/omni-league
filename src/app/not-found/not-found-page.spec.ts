import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotFoundPage } from './not-found-page';

describe('NotFoundPage', () => {
  it('renders the not-found view in the app shell, top bar only', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(NotFoundPage);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.children).toHaveLength(1);
    expect(host.children[0].tagName).toBe('APP-SHELL');
    expect(host.querySelectorAll('header')).toHaveLength(1);
    // No sidebar: no menu button and no navigation landmark (#73 decision 2).
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('nav')).toBeNull();
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
