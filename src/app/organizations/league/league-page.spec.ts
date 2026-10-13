import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { OUTLINE_BUTTON } from '../admin/button-classes';
import { forbiddenError, ME, openAdmin, text } from '../admin/testing/admin-harness';
import {
  COED,
  COED_AS_ORGANIZER,
  GET_ORGANIZER_CONTEXT,
  GULF,
  LEAGUE_ROUTES,
  LEAGUE_URL,
  LIST_FOR_ORGANIZER,
  SEASONS,
} from './testing/league-harness';

// The league management page (#125), design/mockups/125-126-seasons.html states 1 to 3 and 12 to
// 15: what `leagues.getOrganizerContext` decides, the sidebar for each role, and the seasons list.
// The create form is in season-create-form.spec.ts.

const tokens = (value: string) => value.split(' ').sort();

describe('LeaguePage', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(context: unknown, seasons?: unknown[], url = LEAGUE_URL) {
    o = await openAdmin(LEAGUE_ROUTES, url);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(context);
    await o.flush();
    if (seasons) o.subscription(LIST_FOR_ORGANIZER)!.emit(seasons);
    await o.flush();
  }

  const rows = () => [...page.querySelectorAll<HTMLElement>('#seasons-list > li')];

  describe('loading (state 1)', () => {
    it('asks nothing until Convex has accepted the token, and shows the polite status', async () => {
      o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
      TestBed.tick();
      expect(o.convex.subscriptions).toEqual([]);
      expect(text(o.page.querySelector('main [role="status"]'))).toBe('Loading the league.');
      expect(o.page.querySelector('nav')).toBeNull();
      expect(o.page.querySelector('button[aria-label="Open navigation"]')).toBeNull();
    });

    it('asks leagues.getOrganizerContext with both slugs, and no season data, once the token is accepted', async () => {
      o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
      o.acceptToken();
      expect(o.convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
        [GET_ORGANIZER_CONTEXT, { orgSlug: GULF.slug, leagueSlug: COED.slug }],
        [ME, {}],
      ]);
    });
  });

  describe('an org admin (states 2 and 3)', () => {
    it('asks seasons.listForOrganizer with the league id only once the context says ready', async () => {
      await open(COED);
      expect(o.convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
        [GET_ORGANIZER_CONTEXT, { orgSlug: GULF.slug, leagueSlug: COED.slug }],
        [ME, {}],
        [LIST_FOR_ORGANIZER, { leagueId: COED.leagueId }],
      ]);
    });

    it('has the organization, the h1, the status and sport badges, the locations, and the title', async () => {
      await open(COED, []);
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe(GULF.name);
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Coed 7v7 Rec');
      expect(
        [...main.querySelectorAll('h1 + div [data-slot="badge"]')].map((b) => [
          b.getAttribute('data-variant'),
          text(b),
        ]),
      ).toEqual([
        ['default', 'Published'],
        ['secondary', 'Soccer'],
      ]);
      expect(text(main.querySelector('h1 + div + p'))).toBe('Location: Bayside Athletic Complex');
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Coed 7v7 Rec | Gulf Coast Sport & Social | Omni League',
      );
    });

    it('lists the locations of a league held at several', async () => {
      await open({ ...COED, locationNames: ['A Field', 'B Field'] }, []);
      expect(text(page.querySelector('main h1 + div + p'))).toBe('Locations: A Field, B Field');
    });

    it('shows a draft league with the Draft badge', async () => {
      await open({ ...COED, status: 'draft' }, []);
      expect(text(page.querySelector('main h1 + div [data-slot="badge"]'))).toBe('Draft');
    });

    it('uses the admin sidebar with Leagues marked as the section (aria-current="true")', async () => {
      await open(COED, []);
      const nav = page.querySelector('nav')!;
      expect(nav.getAttribute('aria-label')).toBe('Gulf Coast Sport & Social admin');
      expect(text(nav.querySelector('p.text-xs'))).toBe('Admin area');
      const current = nav.querySelector('[aria-current]')!;
      expect(text(current)).toBe('Leagues');
      expect(current.getAttribute('aria-current')).toBe('true');
      expect(page.querySelector('button[aria-label="Open navigation"]')).not.toBeNull();
    });

    it('the "Create a season" link jumps to the form from below 1024px, and moves focus to it', async () => {
      await open(COED, []);
      const link = page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      expect(text(link)).toBe('Create a season');
      expect(link.getAttribute('href')).toBe(`${LEAGUE_URL}#create-season`);
      expect(link.classList.contains('lg:hidden')).toBe(true);
      expect(tokens(link.className.replace(' lg:hidden', ''))).toEqual(tokens(OUTLINE_BUTTON));
      const section = page.querySelector<HTMLElement>('#create-season')!;
      const scrolled = vi.fn();
      section.scrollIntoView = scrolled;
      link.click();
      await o.flush();
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(page.querySelector('#name'));
    });
  });

  describe('a league organizer (states 12 and 13)', () => {
    it('gets the same page with the league organizer’s sidebar: the organization, "Your leagues", and two links', async () => {
      await open(COED_AS_ORGANIZER, []);
      expect(text(page.querySelector('main h1'))).toBe('Coed 7v7 Rec');
      const nav = page.querySelector('nav')!;
      expect(nav.getAttribute('aria-label')).toBe('Gulf Coast Sport & Social leagues');
      expect(text(nav.querySelector('p.font-semibold'))).toBe(GULF.name);
      expect(text(nav.querySelector('p.text-xs'))).toBe('League organizer');
      const lists = [...nav.querySelectorAll('ul')];
      expect(lists.map((l) => l.getAttribute('aria-label'))).toEqual(['Your leagues', null]);
      expect(
        [...lists[0].querySelectorAll('a')].map((a) => [
          text(a),
          a.getAttribute('href'),
          a.getAttribute('aria-current'),
        ]),
      ).toEqual([['Coed 7v7 Rec', LEAGUE_URL, 'page']]);
      expect(
        [...lists[1].querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]),
      ).toEqual([
        ['Public page', `/organizations/${GULF.slug}`],
        ['Your organizations', '/app'],
      ]);
      expect(nav.textContent).not.toContain('Overview');
      expect(nav.textContent).not.toContain('Staff');
    });

    it('asks for the seasons of the league assigned to them', async () => {
      await open(COED_AS_ORGANIZER, []);
      expect(o.subscription(LIST_FOR_ORGANIZER)!.args).toEqual({ leagueId: COED.leagueId });
    });
  });

  describe('the seasons list (states 2 and 3)', () => {
    it('loading: placeholder rows and a polite status, with the create panel already there', async () => {
      await open(COED);
      const panel = page.querySelector('section[aria-labelledby="seasons-heading"]')!;
      expect(text(panel.querySelector('[role="status"]'))).toBe('Loading the seasons.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(panel.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(3);
      expect(text(page.querySelector('#create-season h2'))).toBe('Create a season');
      expect(page.querySelector('#create-season form')).not.toBeNull();
    });

    it('none yet (state 2): the empty state', async () => {
      await open(COED, []);
      const panel = page.querySelector('section[aria-labelledby="seasons-heading"]')!;
      expect(text(panel.querySelector('h2'))).toBe('Seasons');
      expect(text(panel.querySelector('p.font-medium'))).toBe('No seasons yet');
      expect(text(panel)).toContain(
        'Seasons you create appear here as drafts until you publish them.',
      );
      expect(panel.querySelector('ul')).toBeNull();
    });

    it('populated (state 3): a row per season, in the order given, with status, dates, deadline, and format', async () => {
      await open(COED, SEASONS);
      expect(rows().map((li) => text(li.querySelector('h3')))).toEqual([
        'Fall 2027',
        'Summer 2027',
      ]);
      const badge = (li: HTMLElement) => {
        const element = li.querySelector('[data-slot="badge"]')!;
        return [element.getAttribute('data-variant'), text(element)];
      };
      expect(badge(rows()[0])).toEqual(['outline', 'Draft']);
      expect(badge(rows()[1])).toEqual(['default', 'Published']);
      expect([...rows()[0].querySelectorAll('p')].map((p) => text(p))).toEqual([
        'Dates: Sep 8 – Nov 10, 2027',
        'Registration deadline Aug 25, 2027',
        '7 v 7 · at least 9 players',
      ]);
      expect([...rows()[1].querySelectorAll('p')].map((p) => text(p))).toEqual([
        'Dates: Jun 2 – Aug 25, 2027',
        'Registration deadline May 19, 2027',
        '7 v 7 · at least 7 players',
      ]);
      expect(rows()[0].querySelector('.sr-only')?.textContent).toBe('Dates: ');
    });

    it('has a Publish button on the Draft row only, and no link in a row: the season page comes later', async () => {
      await open(COED, SEASONS);
      expect([...page.querySelectorAll('#seasons-list button')].map((b) => text(b))).toEqual([
        'Publish Fall 2027',
      ]);
      expect(page.querySelector('#seasons-list a')).toBeNull();
    });

    it('a failed list shows the destructive alert, never the error message', async () => {
      await open(COED);
      o.subscription(LIST_FOR_ORGANIZER)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = page.querySelector('section[aria-labelledby="seasons-heading"] [role="alert"]');
      expect(text(alert)).toBe(
        'The seasons could not be loaded. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('lists a season created elsewhere at once (the list is live)', async () => {
      await open(COED, SEASONS.slice(1));
      o.subscription(LIST_FOR_ORGANIZER)!.emit(SEASONS);
      await o.flush();
      expect(rows()).toHaveLength(2);
    });
  });

  describe('no access (state 14)', () => {
    async function forbidden() {
      o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
      page = o.page;
      o.acceptToken();
      o.subscription(GET_ORGANIZER_CONTEXT)!.fail(forbiddenError());
      await o.flush();
    }

    it('shows the heading, the sentence, and the link to /app, with no sidebar and no season data requested', async () => {
      await forbidden();
      expect(text(page.querySelector('h1'))).toBe('You can’t manage this league');
      expect(text(page.querySelector('main p'))).toBe(
        'Only org admins and the league organizers assigned to it can open it. If you should have access, ask an org admin to assign it to you.',
      );
      const link = page.querySelector<HTMLAnchorElement>('main a')!;
      expect(link.getAttribute('href')).toBe('/app');
      expect(text(link)).toBe('Go to your organizations');
      expect(page.querySelector('nav')).toBeNull();
      expect(page.querySelector('button[aria-label="Open navigation"]')).toBeNull();
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(o.convex.activeSubscriptions.map((s) => s.name)).toEqual([GET_ORGANIZER_CONTEXT, ME]);
      expect(page.textContent).not.toContain('Coed 7v7 Rec');
    });

    it('sets the page title', async () => {
      await forbidden();
      expect(TestBed.inject(Title).getTitle()).toBe('No access | Omni League');
    });
  });

  describe('an unknown league (state 15)', () => {
    it('shows #23’s not-found view, with no sidebar and no season data requested', async () => {
      o = await openAdmin(LEAGUE_ROUTES, `/app/organizations/${GULF.slug}/leagues/does-not-exist`);
      page = o.page;
      o.acceptToken();
      expect(o.subscription(GET_ORGANIZER_CONTEXT)!.args).toEqual({
        orgSlug: GULF.slug,
        leagueSlug: 'does-not-exist',
      });
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit(null);
      await o.flush();
      expect(text(page.querySelector('h1'))).toBe('Page not found');
      expect(text(page.querySelector('main a'))).toBe('Go to the home page');
      expect(page.querySelector('nav')).toBeNull();
      expect(o.convex.activeSubscriptions.map((s) => s.name)).toEqual([GET_ORGANIZER_CONTEXT, ME]);
    });
  });

  describe('any other failure of the context query', () => {
    it('shows the temporarily-unavailable view, never the error message', async () => {
      o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
      page = o.page;
      o.acceptToken();
      o.subscription(GET_ORGANIZER_CONTEXT)!.fail(new Error('Server Error: secret detail'));
      await o.flush();
      expect(text(page.querySelector('h1'))).toBe('This page is temporarily unavailable');
      expect(page.textContent).not.toContain('secret detail');
      expect(page.querySelector('#create-season')).toBeNull();
    });
  });
});
