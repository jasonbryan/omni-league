import { Component, Injectable, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FragmentLanding, pathOf } from './fragment-landing';

const isReport = (path: string) => /^\/reports\/[^/]+$/.test(path);

@Injectable()
class ReportLanding extends FragmentLanding {
  constructor() {
    super({
      atLoad: (snapshot) => snapshot.fragment === 'summary',
      atArrival: (path, fragment) => isReport(path) && fragment === 'summary',
    });
  }
}

@Component({ template: '<p id="page">page</p>', providers: [ReportLanding] })
class Report {
  readonly landing = inject(ReportLanding);
}

@Component({ template: 'elsewhere' })
class Elsewhere {}

describe('pathOf', () => {
  it.each([
    ['/reports/1', '/reports/1'],
    ['/reports/1#summary', '/reports/1'],
    ['/reports/1?page=2#summary', '/reports/1'],
    ['/reports/1?page=2', '/reports/1'],
  ])('drops the query string and the fragment of %s', (url, path) => {
    expect(pathOf(url)).toBe(path);
  });
});

describe('FragmentLanding', () => {
  let harness: RouterTestingHarness;

  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'reports/:id', component: Report },
          { path: 'elsewhere', component: Elsewhere },
        ]),
      ],
    });
    harness = await RouterTestingHarness.create(url);
  }

  const landing = () => harness.routeDebugElement!.injector.get(ReportLanding);
  const arrive = async (url: string) => {
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
  };

  describe('on a page load', () => {
    it('arms when the route names the fragment', async () => {
      await open('/reports/1#summary');
      expect(landing().pending()).toBe(true);
    });

    it.each(['/reports/1', '/reports/1#details'])('does not arm for %s', async (url) => {
      await open(url);
      expect(landing().pending()).toBe(false);
    });
  });

  describe('on an arrival', () => {
    it('arms on an arrival at another path with the fragment', async () => {
      await open('/reports/1#summary');
      landing().settle();
      await arrive('/reports/2#summary');
      expect(landing().pending()).toBe(true);
    });

    it('does not arm on an arrival without the fragment, and clears a waiting landing', async () => {
      await open('/reports/1#summary');
      await arrive('/reports/2');
      expect(landing().pending()).toBe(false);
    });

    it('does not arm on a change of the fragment alone', async () => {
      await open('/reports/1');
      await arrive('/reports/1#summary');
      expect(landing().pending()).toBe(false);
    });

    it('does not arm again for the path it already shows, with another query string', async () => {
      await open('/reports/1#summary');
      landing().settle();
      await arrive('/reports/1?page=2#summary');
      expect(landing().pending()).toBe(false);
    });

    it('does not arm when the arrival fails the rule', async () => {
      await open('/reports/1');
      const instance = landing();
      await arrive('/elsewhere#summary');
      expect(instance.pending()).toBe(false);
    });
  });

  describe('cancelling', () => {
    it('settles on a later choice', async () => {
      await open('/reports/1#summary');
      document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      expect(landing().pending()).toBe(false);
    });

    it('stops listening once settled, so a later arrival arms a new listener', async () => {
      await open('/reports/1#summary');
      landing().settle();
      await arrive('/reports/2#summary');
      expect(landing().pending()).toBe(true);
      document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      expect(landing().pending()).toBe(false);
    });

    it('keeps the landing when <main> takes focus, and for a press on text inside <main>', async () => {
      await open('/reports/1#summary');
      const main = document.createElement('main');
      main.id = 'main';
      main.tabIndex = -1;
      main.innerHTML = '<p>text</p>';
      document.body.append(main);
      main.focus();
      main.querySelector('p')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(landing().pending()).toBe(true);
      main.remove();
    });

    it('stops listening when the page is destroyed', async () => {
      await open('/reports/1#summary');
      const instance = landing();
      await arrive('/elsewhere');
      document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      expect(instance.pending()).toBe(true);
    });
  });
});
