import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App routing', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  async function renderAt(url: string): Promise<ComponentFixture<App>> {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    return fixture;
  }

  function routed(fixture: ComponentFixture<App>): Element | null | undefined {
    const outlet = (fixture.nativeElement as HTMLElement).querySelector('router-outlet');
    expect(outlet).not.toBeNull();
    return outlet?.nextElementSibling;
  }

  it("renders the placeholder inside the root router-outlet for ''", async () => {
    const page = routed(await renderAt('/'));
    expect(page?.tagName.toLowerCase()).toBe('app-placeholder');
    expect(page?.querySelector('h1')?.textContent).toBe('Omni League');
  });

  it('renders the placeholder in the public layout, with no sidebar', async () => {
    const page = routed(await renderAt('/'));
    expect(page?.firstElementChild?.tagName.toLowerCase()).toBe('app-public-layout');
    expect(page?.querySelector('footer')).not.toBeNull();
    expect(page?.querySelector('button')).toBeNull();
  });

  for (const url of ['/this-page-does-not-exist', '/a/b/c?q=1#x']) {
    it(`renders the not-found page in the public layout for ${url}`, async () => {
      const page = routed(await renderAt(url));
      expect(page?.tagName.toLowerCase()).toBe('app-not-found-page');
      expect(page?.firstElementChild?.tagName.toLowerCase()).toBe('app-public-layout');
      expect(page?.querySelector('h1')?.textContent.trim()).toBe('Page not found');
      expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
    });
  }

  // /app/** keeps the app shell: an unknown signed-in path has no footer.
  it('renders the not-found page in the app shell for an unknown /app path', async () => {
    const page = routed(await renderAt('/app/x'));
    expect(page?.tagName.toLowerCase()).toBe('app-app-not-found-page');
    expect(page?.firstElementChild?.tagName.toLowerCase()).toBe('app-shell');
    expect(page?.querySelector('footer')).toBeNull();
    expect(page?.querySelector('h1')?.textContent.trim()).toBe('Page not found');
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
  });

  it('sets the title back to "Omni League" on the way home from the not-found page', async () => {
    const fixture = await renderAt('/this-page-does-not-exist');
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    expect(routed(fixture)?.tagName.toLowerCase()).toBe('app-placeholder');
    expect(TestBed.inject(Title).getTitle()).toBe('Omni League');
  });
});
