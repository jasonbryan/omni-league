import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { FollowLink, LOAD_PAGE } from './follow-link';

@Component({ selector: 'app-blank', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Blank {}

async function setup(url: string) {
  const loadPage = vi.fn<(url: string) => void>();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      { provide: LOAD_PAGE, useValue: loadPage },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const navigate = vi.spyOn(router, 'navigateByUrl');
  const origin = globalThis.location.origin;
  return { followLink: TestBed.inject(FollowLink), router, navigate, loadPage, origin };
}

describe('FollowLink.follow', () => {
  it('loads another origin as a page, with no router navigation, and keeps its own query string', async () => {
    const { followLink, navigate, loadPage } = await setup('/organizations/a?utm_source=x');
    followLink.follow('https://evil.example/path?own=1#frag');
    expect(navigate).not.toHaveBeenCalled();
    expect(loadPage).toHaveBeenCalledExactlyOnceWith('https://evil.example/path?own=1#frag');
  });

  it('never navigates to another site for a query string that holds a URL', async () => {
    const { followLink, navigate, loadPage, origin } = await setup(
      '/organizations/a?next=//evil.example&u=https://evil.example/',
    );
    followLink.follow(`${origin}/organizations/a#league-2`);
    expect(loadPage).not.toHaveBeenCalled();
    const target = String(navigate.mock.calls[0][0]);
    expect(target).toMatch(/^\/organizations\/a\?/);
    expect(target).toMatch(/#league-2$/);
    expect(target).toContain('evil.example');
    expect(target.startsWith('//')).toBe(false);
    expect(new URL(target, origin).origin).toBe(origin);
  });

  it('a link to the home page with a query string on it stays one slash', async () => {
    const { followLink, navigate, origin } = await setup('/?utm_source=x');
    followLink.follow(`${origin}/#top`);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/?utm_source=x#top');
  });

  it('falls back to a page load, of the same origin, when the router rejects the URL', async () => {
    const { followLink, router, loadPage, origin } = await setup('/organizations/a?utm_source=x');
    vi.spyOn(router, 'navigateByUrl').mockRejectedValue(new Error('no route'));
    followLink.follow(`${origin}/(//evil.example)#row`);
    await vi.waitFor(() => {
      expect(loadPage).toHaveBeenCalledTimes(1);
    });
    expect(new URL(loadPage.mock.calls[0][0]).origin).toBe(origin);
  });

  it('keeps a link to another path on the site as it is, with its own query string and fragment', async () => {
    const { followLink, navigate, router, origin } = await setup('/organizations/a?utm_source=x');
    followLink.follow(`${origin}/organizations/b?own=1#row`);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/organizations/b?own=1#row');
    await vi.waitFor(() => {
      expect(router.url).toBe('/organizations/b?own=1#row');
    });
  });
});
