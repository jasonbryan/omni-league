import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { AppNotFoundPage } from './app-not-found-page';

describe('AppNotFoundPage', () => {
  it('renders the not-found view in the app shell, with the home sidebar and no top bar from 1024px', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: CONVEX_CLIENT, useValue: new FakeConvexClient() }, provideRouter([])],
    });
    const fixture = TestBed.createComponent(AppNotFoundPage);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.children).toHaveLength(1);
    expect(host.children[0]?.tagName).toBe('APP-SHELL');
    expect(host.querySelectorAll('header')).toHaveLength(1);
    expect(host.querySelector('header')?.classList).toContain('lg:hidden');
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Your account');
    expect(host.querySelector('footer')).toBeNull();
    const main = host.querySelector('main#main');
    expect(main?.children).toHaveLength(1);
    expect(main?.children[0]?.tagName).toBe('APP-NOT-FOUND-VIEW');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('a[href^="/sign-in"]')).toBeNull();
  });
});
