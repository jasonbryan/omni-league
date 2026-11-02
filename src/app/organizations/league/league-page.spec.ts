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
  LIST_CUSTOM_LEVELS,
  LIST_FOR_ORGANIZER,
  SEASONS,
} from './testing/league-harness';

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
      expect(o.page.querySelector('button[aria-label="Open navigation"]')).not.toBeNull();
    });

    it('reserves the breadcrumb’s one-line height, 44px on touch, above the heading bar', async () => {
      o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
      TestBed.tick();
      const skeleton = o.page.querySelector('app-league-loading')!;
      const crumbRow = skeleton.querySelector<HTMLElement>('[data-slot="crumb-row"]')!;
      expect(tokens(crumbRow.className)).toEqual(
        expect.arrayContaining(['h-5', 'pointer-coarse:h-11']),
      );
      const headingBar = crumbRow.nextElementSibling as HTMLElement;
      expect(tokens(headingBar.className)).toEqual(expect.arrayContaining(['mt-1', 'h-8']));
    });

    it('asks leagues.getOrganizerContext with both slugs, and no season data, once the token is accepted', async () => {
      o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
      o.acceptToken();
      expect(o.convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
        [GET_ORGANIZER_CONTEXT, { orgSlug: GULF.slug, leagueSlug: COED.slug }],
        [ME, {}],
        [ME, {}],
      ]);
    });
  });

  describe('an org admin (states 2 and 3)', () => {
    it('asks seasons.listForOrganizer with the league id only once the context says ready', async () => {
      await open(COED);
      const key = ([name, args]: [string, unknown]) => `${name} ${JSON.stringify(args)}`;
      const sidebarCounts = [
        'leagues:publishedCount',
        'leagues:listForAdmin',
        'locations:listForAdmin',
        'memberships:listForOrganization',
      ].map((name): [string, unknown] => [name, { organizationId: COED.organizationId }]);
      const expected: [string, unknown][] = [
        [GET_ORGANIZER_CONTEXT, { orgSlug: GULF.slug, leagueSlug: COED.slug }],
        [ME, {}],
        [ME, {}],
        [LIST_FOR_ORGANIZER, { leagueId: COED.leagueId }],
        [LIST_CUSTOM_LEVELS, { organizationId: COED.organizationId, sport: 'soccer' }],
        ...sidebarCounts,
      ];
      expect(
        o.convex.activeSubscriptions
          .map((s): [string, unknown] => [s.name, s.args])
          .map(key)
          .sort(),
      ).toEqual(expected.map(key).sort());
    });

    it('has the organization, the h1, the status and sport badges, the locations, and the title', async () => {
      await open(COED, []);
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('nav[aria-label="Breadcrumb"] a'))).toBe(GULF.name);
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
      const head = nav.querySelector('a')!;
      expect(head.getAttribute('href')).toBe('/app');
      expect(text(head)).toContain('Switch organization');
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

  describe('the league details', () => {
    it('is a section under the seasons, with its own link to jump to it from every width', async () => {
      await open(COED, []);
      const link = [...page.querySelectorAll<HTMLAnchorElement>('main a[data-slot="button"]')].find(
        (a) => text(a) === 'Edit details',
      )!;
      expect(link.getAttribute('href')).toBe(`${LEAGUE_URL}#details`);
      expect(link.classList.contains('lg:hidden')).toBe(false);
      const section = page.querySelector<HTMLElement>('#details')!;
      expect(section.tagName).toBe('SECTION');
      const scrolled = vi.fn();
      section.scrollIntoView = scrolled;
      link.click();
      await o.flush();
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(page.querySelector('#league-name'));
    });

    it('is shown to the league organizer too', async () => {
      await open(COED_AS_ORGANIZER, []);
      expect(page.querySelector('#details form')).not.toBeNull();
    });
  });

  describe('a league organizer (states 12 and 13)', () => {
    it('gets the same page with the league organizer’s sidebar: the organization, "Your leagues", and Public page', async () => {
      await open(COED_AS_ORGANIZER, []);
      expect(text(page.querySelector('main h1'))).toBe('Coed 7v7 Rec');
      const nav = page.querySelector('nav')!;
      expect(nav.getAttribute('aria-label')).toBe('Gulf Coast Sport & Social leagues');
      const head = nav.querySelector('a')!;
      expect(head.getAttribute('href')).toBe('/app');
      expect(text(head.querySelector('.truncate'))).toBe(GULF.name);
      expect(text(head.querySelector('span.block.text-xs'))).toBe('League organizer');
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
      ).toEqual([['Public page', `/organizations/${GULF.slug}`]]);
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
        'Each run of Coed 7v7 Rec is a season, with its own dates, registration, teams, and schedule. Seasons you create appear here as drafts until you publish them.',
      );
      expect(panel.querySelector('ul')).toBeNull();
    });

    it('none yet: the empty state’s "Create a season" link jumps to the form and moves focus to it', async () => {
      await open(COED, []);
      const link = page.querySelector<HTMLAnchorElement>(
        'section[aria-labelledby="seasons-heading"] a',
      )!;
      expect(text(link)).toBe('Create a season');
      expect(link.getAttribute('href')).toBe(`${LEAGUE_URL}#create-season`);
      const section = page.querySelector<HTMLElement>('#create-season')!;
      const scrolled = vi.fn();
      section.scrollIntoView = scrolled;
      link.click();
      await o.flush();
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(page.querySelector('#name'));
    });

    it('populated: the list carries no "Create a season" link', async () => {
      await open(COED, SEASONS);
      expect(
        page.querySelector('section[aria-labelledby="seasons-heading"] a[href$="#create-season"]'),
      ).toBeNull();
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
        '7v7 · at least 9 players',
      ]);
      expect([...rows()[1].querySelectorAll('p')].map((p) => text(p))).toEqual([
        'Dates: Jun 2 – Aug 25, 2027',
        'Registration deadline May 19, 2027',
        '7v7 · at least 7 players',
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

    it('shows the heading, the sentence, and the link to /app, with the home sidebar and no season data requested', async () => {
      await forbidden();
      expect(text(page.querySelector('h1'))).toBe('You can’t manage this league');
      expect(text(page.querySelector('main p'))).toBe(
        'Only org admins and the league organizers assigned to it can open it. If you should have access, ask an org admin to assign it to you.',
      );
      const link = page.querySelector<HTMLAnchorElement>('main a')!;
      expect(link.getAttribute('href')).toBe('/app');
      expect(text(link)).toBe('Go to your organizations');
      expect(page.querySelector('nav')?.getAttribute('aria-label')).toBe('Your account');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(o.convex.activeSubscriptions.map((s) => s.name)).toEqual([
        GET_ORGANIZER_CONTEXT,
        ME,
        ME,
        'organizations:listMine',
      ]);
      expect(page.textContent).not.toContain('Coed 7v7 Rec');
    });

    it('sets the page title', async () => {
      await forbidden();
      expect(TestBed.inject(Title).getTitle()).toBe('No access | Omni League');
    });
  });

  describe('an unknown league (state 15)', () => {
    it('shows the not-found view, with the home sidebar and no season data requested', async () => {
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
      expect(page.querySelector('nav')?.getAttribute('aria-label')).toBe('Your account');
      expect(o.convex.activeSubscriptions.map((s) => s.name)).toEqual([
        GET_ORGANIZER_CONTEXT,
        ME,
        ME,
        'organizations:listMine',
      ]);
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

  describe('landing at the section a fragment names', () => {
    const scrolled = vi.fn();
    beforeEach(() => {
      scrolled.mockClear();
      Element.prototype.scrollIntoView = scrolled;
    });
    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    });

    const FIELDS = { details: '#league-name', 'create-season': '#name' } as const;
    const url = (fragment: string) => `${LEAGUE_URL}#${fragment}`;
    const field = (fragment: keyof typeof FIELDS) =>
      page.querySelector<HTMLElement>(FIELDS[fragment])!;
    const scrolledTo = () => (scrolled.mock.contexts as HTMLElement[]).map((element) => element.id);

    async function openPending(target: string) {
      o = await openAdmin(LEAGUE_ROUTES, target);
      page = o.page;
      o.acceptToken();
      await o.flush();
    }
    const league = async (context: unknown = COED) => {
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit(context);
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
      'the wheel': () => document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true })),
      'a touch scroll': () =>
        document.body.dispatchEvent(new Event('touchmove', { bubbles: true })),
      'Page Down': () =>
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }),
        ),
    };

    it.each(Object.keys(FIELDS) as (keyof typeof FIELDS)[])(
      'focuses the field of #%s once the league loads, and scrolls to its section',
      async (fragment) => {
        await openPending(url(fragment));
        expect(document.activeElement).toBe(document.body);
        await league();
        await o.flush();
        expect(document.activeElement).toBe(field(fragment));
        expect(scrolledTo()).toEqual([fragment]);
      },
    );

    it.each(Object.keys(FIELDS) as (keyof typeof FIELDS)[])(
      'lands the same way for a league organizer on #%s, and never on the Seasons heading',
      async (fragment) => {
        await open(COED_AS_ORGANIZER, SEASONS, url(fragment));
        expect(document.activeElement).toBe(field(fragment));
        expect(page.querySelector('#seasons-heading')).not.toBe(document.activeElement);
        expect(rows().some((row) => row.contains(document.activeElement))).toBe(false);
      },
    );

    it('lands once: a later update of the league or the list leaves focus where the user put it', async () => {
      await open(COED, SEASONS, url('details'));
      expect(document.activeElement).toBe(field('details'));
      field('create-season').focus();
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit({ ...COED, name: 'Renamed' });
      o.subscription(LIST_FOR_ORGANIZER)!.emit([...SEASONS]);
      await o.flush();
      expect(document.activeElement).toBe(field('create-season'));
    });

    it('lands again on the next arrival at the page', async () => {
      await open(COED, SEASONS, url('details'));
      await o.harness.navigateByUrl('/app');
      await o.harness.navigateByUrl(url('create-season'));
      page = o.harness.routeNativeElement!;
      await league();
      await o.flush();
      expect(document.activeElement).toBe(field('create-season'));
    });

    it('lands again when only the league changes and the user comes back to the fragment', async () => {
      const OTHER = { ...COED, leagueId: 'lg_other', slug: 'other-league', name: 'Other' };
      await open(COED, SEASONS, url('details'));
      const first = page;
      expect(document.activeElement).toBe(field('details'));
      await o.harness.navigateByUrl(`/app/organizations/${GULF.slug}/leagues/${OTHER.slug}`);
      expect(o.harness.routeNativeElement).toBe(first);
      document.body.focus();
      await o.flush();
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit(OTHER);
      await o.flush();
      expect(document.activeElement).not.toBe(field('details'));
      await o.harness.navigateByUrl(url('details'));
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit(COED);
      await o.flush();
      expect(document.activeElement).toBe(field('details'));
    });

    it('lands after <main> takes focus on an in-app navigation, which is not a later choice', async () => {
      o = await openAdmin(LEAGUE_ROUTES, '/app');
      page = o.page;
      o.acceptToken();
      await o.harness.navigateByUrl(url('details'));
      page = o.harness.routeNativeElement!;
      const main = document.getElementById('main')!;
      main.focus();
      expect(document.activeElement).toBe(main);
      await league();
      await o.flush();
      expect(document.activeElement).toBe(field('details'));
    });

    for (const [name, choose] of Object.entries(choices)) {
      it.each(Object.keys(FIELDS) as (keyof typeof FIELDS)[])(
        `${name} before the league loads cancels the landing on #%s`,
        async (fragment) => {
          await openPending(url(fragment));
          choose();
          const focused = document.activeElement;
          await league();
          await o.flush();
          expect(document.activeElement).toBe(focused);
          expect(scrolled).not.toHaveBeenCalled();
        },
      );
      it(`${name} before the list arrives cancels the landing on #season-…`, async () => {
        await open(COED, undefined, url('season-summer-2027'));
        choose();
        const focused = document.activeElement;
        o.subscription(LIST_FOR_ORGANIZER)!.emit(SEASONS);
        await o.flush();
        expect(document.activeElement).toBe(focused);
        expect(scrolled).not.toHaveBeenCalled();
      });
    }

    it.each(['nothing', 'season', 'seasons-list'])(
      'leaves the page as it is for a fragment it does not know, #%s',
      async (fragment) => {
        await open(COED, SEASONS, url(fragment));
        expect(document.activeElement).toBe(document.body);
        expect(scrolled).not.toHaveBeenCalled();
      },
    );

    it('shows the no-access view as before, with a fragment', async () => {
      await openPending(url('details'));
      o.subscription(GET_ORGANIZER_CONTEXT)!.fail(forbiddenError());
      await o.flush();
      expect(page.querySelector('app-league-no-access')).not.toBeNull();
      expect(document.activeElement).toBe(document.body);
    });
  });

  describe('finding a season by its address', () => {
    const scrolled = vi.fn();
    beforeEach(() => {
      scrolled.mockClear();
      Element.prototype.scrollIntoView = scrolled;
    });
    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    });

    const FRAGMENT_URL = `${LEAGUE_URL}#season-summer-2027`;
    const seasonsHeading = () => page.querySelector<HTMLElement>('#seasons-heading')!;
    const title = (n: number) => rows()[n].querySelector<HTMLElement>('h3')!;

    it('gives each row an id from its slug and a title that takes focus', async () => {
      await open(COED, SEASONS);
      expect(rows().map((row) => row.id)).toEqual(['season-fall-2027', 'season-summer-2027']);
      expect(title(0).getAttribute('tabindex')).toBe('-1');
      expect(seasonsHeading().getAttribute('tabindex')).toBe('-1');
    });

    it('focuses the row title once the list arrives', async () => {
      await open(COED, undefined, FRAGMENT_URL);
      expect(document.activeElement).not.toBe(seasonsHeading());
      o.subscription(LIST_FOR_ORGANIZER)!.emit(SEASONS);
      await o.flush();
      expect(document.activeElement).toBe(title(1));
    });

    it('focuses the Seasons heading for a slug no row has', async () => {
      await open(COED, SEASONS, `${LEAGUE_URL}#season-nope`);
      expect(document.activeElement).toBe(seasonsHeading());
    });

    it('focuses the Seasons heading when the list fails', async () => {
      await open(COED, undefined, FRAGMENT_URL);
      o.subscription(LIST_FOR_ORGANIZER)!.fail(new Error('Server Error'));
      await o.flush();
      expect(document.activeElement).toBe(seasonsHeading());
    });

    it('lands once: a later update of the list leaves focus where the user put it', async () => {
      await open(COED, SEASONS, FRAGMENT_URL);
      expect(document.activeElement).toBe(title(1));
      page.querySelector<HTMLInputElement>('#name')!.focus();
      o.subscription(LIST_FOR_ORGANIZER)!.emit([
        ...SEASONS,
        { ...SEASONS[0], seasonId: 'se_x', slug: 'x-2028', name: 'X 2028' },
      ]);
      await o.flush();
      expect(document.activeElement).toBe(page.querySelector('#name'));
    });

    describe('the Show it in Seasons link', () => {
      async function createdIn(context: unknown, seasons?: unknown[]) {
        await open(context, seasons);
        for (const [id, value] of [
          ['name', 'Summer 2027'],
          ['start-date', '2027-06-02'],
          ['end-date', '2027-08-25'],
          ['registration-deadline', '2027-05-19'],
        ]) {
          const input = page.querySelector<HTMLInputElement>(`#${id}`)!;
          input.value = value;
          input.dispatchEvent(new Event('input'));
          await o.harness.fixture.whenStable();
        }
        page.querySelector<HTMLButtonElement>('#create-season button[type="submit"]')!.click();
        await o.flush();
        o.convex.calls[0].resolve({ seasonId: 'se_summer27' });
        await o.flush();
      }
      const link = () => page.querySelector<HTMLAnchorElement>('[data-created-action]')!;
      const DRAFT = { ...COED, status: 'draft' };

      it('moves focus to the new row’s title', async () => {
        await createdIn(DRAFT, SEASONS);
        const scrolled = vi.fn();
        title(1).scrollIntoView = scrolled;
        link().click();
        await o.flush();
        expect(scrolled).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(title(1));
      });

      it('moves focus to the Seasons heading while the list is loading, and keeps it there when the rows arrive', async () => {
        await createdIn(DRAFT);
        seasonsHeading().scrollIntoView = vi.fn();
        link().click();
        await o.flush();
        expect(document.activeElement).toBe(seasonsHeading());
        o.subscription(LIST_FOR_ORGANIZER)!.emit(SEASONS);
        await o.flush();
        expect(document.activeElement).toBe(seasonsHeading());
      });

      it('moves focus to the Seasons heading when the list failed', async () => {
        await createdIn(DRAFT);
        o.subscription(LIST_FOR_ORGANIZER)!.fail(new Error('Server Error'));
        await o.flush();
        seasonsHeading().scrollIntoView = vi.fn();
        link().click();
        await o.flush();
        expect(document.activeElement).toBe(seasonsHeading());
      });
    });
  });
});
