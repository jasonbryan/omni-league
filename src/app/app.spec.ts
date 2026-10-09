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

  for (const url of ['/this-page-does-not-exist', '/app/x', '/a/b/c?q=1#x']) {
    it(`renders the not-found page for ${url}`, async () => {
      const page = routed(await renderAt(url));
      expect(page?.tagName.toLowerCase()).toBe('app-not-found-page');
      expect(page?.querySelector('h1')?.textContent.trim()).toBe('Page not found');
      expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
    });
  }

  it('sets the title back to "Omni League" on the way home from the not-found page', async () => {
    const fixture = await renderAt('/this-page-does-not-exist');
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    expect(routed(fixture)?.tagName.toLowerCase()).toBe('app-placeholder');
    expect(TestBed.inject(Title).getTitle()).toBe('Omni League');
  });
});
