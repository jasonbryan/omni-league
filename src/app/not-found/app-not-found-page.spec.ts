import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppNotFoundPage } from './app-not-found-page';

describe('AppNotFoundPage', () => {
  it('renders the not-found view in the app shell, top bar only', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(AppNotFoundPage);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.children).toHaveLength(1);
    expect(host.children[0].tagName).toBe('APP-SHELL');
    expect(host.querySelectorAll('header')).toHaveLength(1);
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('nav')).toBeNull();
    expect(host.querySelector('footer')).toBeNull();
    const main = host.querySelector('main#main');
    expect(main?.children).toHaveLength(1);
    expect(main?.children[0].tagName).toBe('APP-NOT-FOUND-VIEW');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect([...host.querySelectorAll('header a')].map((a) => a.textContent.trim())).toEqual([
      'Omni League',
      'Sign in',
    ]);
    expect([...(main?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
      '/',
    ]);
  });
});
