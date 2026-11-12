import { Component } from '@angular/core';
import { AdminArea } from './admin-area';
import { CreateLeagueLanding } from './create-league-landing';
import { adminRoutes, COASTAL, GET_ADMIN_CONTEXT, openAdmin } from './testing/admin-harness';

@Component({ template: '<p id="child">child</p>' })
class Child {}

const ROUTES = adminRoutes(AdminArea, [
  { path: '', component: Child },
  { path: 'leagues', component: Child },
  { path: 'tournaments', component: Child },
  { path: 'locations', component: Child },
]);
const BASE = `/app/organizations/${COASTAL.slug}`;
const LEAGUES = `${BASE}/leagues`;
const TOURNAMENTS = `${BASE}/tournaments`;

describe('CreateLeagueLanding', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;

  async function open(url: string) {
    o = await openAdmin(ROUTES, url);
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
  }

  const landing = () => o.harness.routeDebugElement!.injector.get(CreateLeagueLanding);
  const arrive = async (url: string) => {
    await o.harness.navigateByUrl(url);
    await o.flush();
  };

  const choices = {
    'a focusin on another control': () => {
      const button = document.createElement('button');
      document.body.append(button);
      button.focus();
      button.remove();
    },
    'a press on a link that takes no focus': () => {
      const link = document.createElement('a');
      link.href = '/elsewhere';
      link.addEventListener('click', (event) => event.preventDefault());
      document.body.append(link);
      link.click();
      link.remove();
    },
    'a press outside <main>': () =>
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    'the wheel': () => document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true })),
    'a touch scroll': () => document.body.dispatchEvent(new Event('touchmove', { bubbles: true })),
    'Page Down': () =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })),
  };

  describe('on a page load', () => {
    it('arms for the Leagues path with #create-league, while the admin area is still loading', async () => {
      o = await openAdmin(ROUTES, `${LEAGUES}#create-league`);
      expect(landing().pending()).toBe(true);
    });

    it.each([
      ['no fragment', LEAGUES],
      ['another fragment', `${LEAGUES}#details`],
      ['another admin path with #create-league', `${BASE}/locations#create-league`],
      ['the Overview with #create-league', `${BASE}#create-league`],
      ['Leagues with the form of Tournaments', `${LEAGUES}#create-tournament`],
      ['Tournaments with the form of Leagues', `${TOURNAMENTS}#create-league`],
      ['Tournaments with no fragment', TOURNAMENTS],
    ])('does not arm for %s', async (_name, url) => {
      o = await openAdmin(ROUTES, url);
      expect(landing().pending()).toBe(false);
    });
  });

  describe('on a page load at Tournaments', () => {
    it('arms for the Tournaments path with #create-tournament', async () => {
      o = await openAdmin(ROUTES, `${TOURNAMENTS}#create-tournament`);
      expect(landing().pending()).toBe(true);
    });
  });

  describe('on an arrival', () => {
    it('arms on an arrival at the Tournaments path with #create-tournament, and not with #create-league', async () => {
      await open(BASE);
      await arrive(`${TOURNAMENTS}#create-league`);
      expect(landing().pending()).toBe(false);
      await arrive(`${TOURNAMENTS}#create-tournament`);
      expect(landing().pending()).toBe(false);
      await arrive(BASE);
      await arrive(`${TOURNAMENTS}#create-tournament`);
      expect(landing().pending()).toBe(true);
    });

    it('arms on each arrival at the Leagues path with #create-league', async () => {
      await open(BASE);
      expect(landing().pending()).toBe(false);
      await arrive(`${LEAGUES}#create-league`);
      expect(landing().pending()).toBe(true);
      landing().settle();
      await arrive(`${BASE}/locations`);
      await arrive(`${LEAGUES}#create-league`);
      expect(landing().pending()).toBe(true);
    });

    it('does not arm on another admin path with #create-league', async () => {
      await open(BASE);
      await arrive(`${BASE}/locations#create-league`);
      expect(landing().pending()).toBe(false);
    });

    it('clears a waiting target on an arrival at another admin path', async () => {
      await open(`${LEAGUES}#create-league`);
      expect(landing().pending()).toBe(true);
      await arrive(`${BASE}/locations#create-league`);
      expect(landing().pending()).toBe(false);
    });

    it('clears a waiting target on an arrival straight at the Leagues path of another organization with no fragment', async () => {
      await open(`${LEAGUES}#create-league`);
      expect(landing().pending()).toBe(true);
      await arrive('/app/organizations/other-club/leagues');
      expect(landing().pending()).toBe(false);
    });

    it('does not arm on a change of the fragment alone', async () => {
      await open(LEAGUES);
      await arrive(`${LEAGUES}#create-league`);
      expect(landing().pending()).toBe(false);
    });

    it('does not arm again for the page it already shows', async () => {
      await open(`${LEAGUES}#create-league`);
      landing().settle();
      await arrive(`${LEAGUES}?page=2#create-league`);
      expect(landing().pending()).toBe(false);
    });
  });

  describe('cancelling', () => {
    it.each(Object.keys(choices) as (keyof typeof choices)[])(
      'is cancelled by %s while it waits',
      async (name) => {
        o = await openAdmin(ROUTES, `${LEAGUES}#create-league`);
        choices[name]();
        expect(landing().pending()).toBe(false);
      },
    );

    it('is cancelled by a later choice made after an arrival', async () => {
      await open(BASE);
      await arrive(`${LEAGUES}#create-league`);
      choices['the wheel']();
      expect(landing().pending()).toBe(false);
    });

    it('keeps the landing when <main> takes focus, which is the router’s own focus', async () => {
      o = await openAdmin(ROUTES, `${LEAGUES}#create-league`);
      const main = document.getElementById('main')!;
      main.focus();
      expect(document.activeElement).toBe(main);
      expect(landing().pending()).toBe(true);
    });

    it('keeps the landing for a press on text inside <main>', async () => {
      o = await openAdmin(ROUTES, `${LEAGUES}#create-league`);
      const text = document.querySelector('#main [role="status"]')!;
      text.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      text.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(landing().pending()).toBe(true);
    });
  });
});
