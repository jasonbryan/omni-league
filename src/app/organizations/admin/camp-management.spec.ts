import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { CAMP_SESSION_MESSAGES } from '../../../../convex/lib/campSessionInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { expectBadgeSize } from '../../ui/testing/badge';
import { expectBareCards } from '../../ui/testing/card';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { PRIMARY_BUTTON } from './button-classes';
import {
  COASTAL,
  expectPageAndShellSubscriptions,
  forbiddenError,
  openAdmin,
  text,
} from './testing/admin-harness';
import {
  ADD_SESSION,
  AS_ORGANIZER,
  CAMP,
  CAMPS_BASE,
  CAMP_ARGS,
  CAMP_ROUTES,
  CAMP_URL,
  GET_CAMP,
  LIST_MINE,
  LIST_SESSIONS,
  REMOVE_SESSION,
  SESSIONS,
  SESSIONS_ARGS,
  session,
} from './testing/camp-harness';

const tokens = (value: string) => value.split(' ').sort();

describe('CampManagement', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(result?: unknown, sessions?: unknown[], url = CAMP_URL) {
    o = await openAdmin(CAMP_ROUTES, url);
    page = o.page;
    o.acceptToken();
    await o.flush();
    if (result !== undefined) o.subscription(GET_CAMP)!.emit(result);
    await o.flush();
    if (sessions) o.subscription(LIST_SESSIONS)!.emit(sessions);
    await o.flush();
  }

  const main = () => page.querySelector('main')!;
  const sessionsCard = () => page.querySelector<HTMLElement>('#sessions')!;
  const items = () => [...page.querySelectorAll<HTMLElement>('#sessions-list > li')];
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const status = () => page.querySelector<HTMLElement>('[data-slot="session-status"]')!;
  const deleteButton = (name: string) =>
    items()
      .find((li) => text(li.querySelector('h3')) === name)!
      .querySelector<HTMLButtonElement>('button')!;
  const undoButton = () =>
    [...status().querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === 'Undo')!;
  const details = () =>
    [...page.querySelectorAll('#details dl > div')].map((row) => [
      text(row.querySelector('dt')),
      [...row.querySelectorAll('dd')].map(text),
    ]);

  describe('the page', () => {
    it('asks camps.getForManagement with the route’s slugs once the token is accepted, and the sessions only once the camp has answered, with its id', async () => {
      o = await openAdmin(CAMP_ROUTES, CAMP_URL);
      expect(o.subscription(GET_CAMP)).toBeUndefined();
      o.acceptToken();
      await o.flush();
      expect(o.subscription(GET_CAMP)!.args).toEqual(CAMP_ARGS);
      expect(o.subscription(LIST_SESSIONS)).toBeUndefined();
      o.subscription(GET_CAMP)!.emit(CAMP);
      await o.flush();
      expect(o.subscription(LIST_SESSIONS)!.args).toEqual(SESSIONS_ARGS);
    });

    it('an org admin gets the admin sidebar, with Camps marked, and the admin counts', async () => {
      await open(CAMP, []);
      expectPageAndShellSubscriptions(o.convex, [
        [GET_CAMP, CAMP_ARGS],
        [LIST_SESSIONS, SESSIONS_ARGS],
      ]);
      const nav = page.querySelector('nav[aria-label="Coastal Bend Rec Club admin"]')!;
      expect(
        [...nav.querySelectorAll('a[aria-current]')].map((a) => [
          text(a),
          a.getAttribute('aria-current'),
        ]),
      ).toEqual([['Camps', 'true']]);
      expect(o.convex.activeSubscriptions.map((s) => s.name)).not.toContain(LIST_MINE);
    });

    it('loading: skeleton shapes and a polite status, in the shell', async () => {
      await open();
      expect(text(main().querySelector('[role="status"]'))).toBe('Loading the camp.');
      expect(main().querySelector('h1')).toBeNull();
      expectSkeletonBoxes(main(), { 'rounded-md': 8 });
    });

    it('a null answer shows the not-found view', async () => {
      await open(null);
      expect(text(main().querySelector('h1'))).toBe('Page not found');
      expect(page.querySelector('app-not-found-view')).not.toBeNull();
      expect(o.subscription(LIST_SESSIONS)).toBeUndefined();
    });

    it('a forbidden answer shows the no-access view for the camp, with no sidebar and no camp data, and asks for no sessions', async () => {
      await open();
      o.subscription(GET_CAMP)!.fail(forbiddenError());
      await o.flush();
      expect(text(main().querySelector('h1'))).toBe('You can’t manage this camp');
      expect(text(main().querySelector('h1 + p'))).toBe(
        'Only org admins and the league organizers assigned to it can open it. If you should have access, ask an org admin to assign it to you.',
      );
      const link = main().querySelector<HTMLAnchorElement>('a[data-slot="button"]')!;
      expect([text(link), link.getAttribute('href')]).toEqual(['Go to your organizations', '/app']);
      expect(tokens(link.className)).toEqual(tokens(PRIMARY_BUTTON + ' mt-8'));
      expect(page.querySelector('app-admin-sidebar, app-league-sidebar')).toBeNull();
      expect(page.textContent).not.toContain('Junior Beach Volleyball Camp');
      expect(TestBed.inject(Title).getTitle()).toBe('No access | Omni League');
      expect(o.subscription(LIST_SESSIONS)).toBeUndefined();
    });

    it('a failed query shows the server-error view, never the error message, and Try again keeps the page', async () => {
      await open();
      o.subscription(GET_CAMP)!.fail(new Error('Server Error: secret'));
      await o.flush();
      expect(page.querySelector('app-server-error-view')).not.toBeNull();
      expect(page.textContent).not.toContain('secret');
      expect(main().querySelector('a')?.getAttribute('href')).toBe(CAMP_URL);
    });
  });

  describe('an assigned organizer', () => {
    beforeEach(() => open(AS_ORGANIZER, []));

    it('manages the camp, and the breadcrumb leads to Your organizations, which they can open', () => {
      const links = [...main().querySelectorAll('nav[aria-label="Breadcrumb"] a')];
      expect(links.map(text)).toEqual(['Your organizations', 'Junior Beach Volleyball Camp']);
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/app', CAMP_URL]);
      expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page']);
      expect(page.querySelector('#add-session')).not.toBeNull();
    });

    it('gets the organizer sidebar, listing their camps as links with this one marked, and none of the admin counts', async () => {
      const nav = page.querySelector('nav[aria-label="Coastal Bend Rec Club camps"]')!;
      expect(nav).not.toBeNull();
      expect(page.querySelector('app-admin-sidebar')).toBeNull();
      expect(o.subscription(LIST_MINE)?.args).toEqual({});
      o.subscription(LIST_MINE)!.emit([
        {
          name: COASTAL.name,
          slug: COASTAL.slug,
          role: 'leagueOrganizer',
          leagues: [],
          camps: [
            { name: 'Fall Break Camp', slug: 'fall-break-camp' },
            { name: 'Junior Beach Volleyball Camp', slug: 'junior-beach-volleyball-camp' },
          ],
        },
      ]);
      await o.flush();
      expect(
        [...nav.querySelectorAll('ul[aria-label="Your camps"] a')].map((a) => [
          text(a),
          a.getAttribute('href'),
          a.getAttribute('aria-current'),
        ]),
      ).toEqual([
        ['Fall Break Camp', `${CAMPS_BASE}/fall-break-camp`, null],
        ['Junior Beach Volleyball Camp', CAMP_URL, 'page'],
      ]);
      expect(nav.textContent).not.toContain('Your leagues');
    });

    it('adds a session with the same call an org admin makes', async () => {
      const add = page.querySelector<HTMLFormElement>('#add-session form')!;
      const set = (id: string, value: string) => {
        const input = add.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('name', 'Week 1');
      set('start-date', '2027-07-05');
      set('end-date', '2027-07-09');
      set('places', '20');
      set('registration-deadline', '2027-07-01');
      await o.harness.fixture.whenStable();
      add.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await o.flush();
      expect(calls()).toEqual([
        [
          ADD_SESSION,
          {
            campId: 'cp_junior',
            name: 'Week 1',
            startDate: '2027-07-05',
            endDate: '2027-07-09',
            places: 20,
            registrationDeadline: '2027-07-01',
          },
        ],
      ]);
    });
  });

  describe('the camp', () => {
    beforeEach(() => open(CAMP, []));

    it('has the breadcrumb organization, Camps, and the camp as the current page, and one h1', () => {
      const links = [...main().querySelectorAll('nav[aria-label="Breadcrumb"] a')];
      expect(links.map(text)).toEqual([COASTAL.name, 'Camps', 'Junior Beach Volleyball Camp']);
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        `/app/organizations/${COASTAL.slug}`,
        CAMPS_BASE,
        CAMP_URL,
      ]);
      expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page']);
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main().querySelector('h1'))).toBe('Junior Beach Volleyball Camp');
    });

    it('sets the title', () => {
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Junior Beach Volleyball Camp | Coastal Bend Rec Club | Omni League',
      );
    });

    it('shows Draft and the sport as badges, and Published for a published camp', async () => {
      const badges = () => [...main().querySelectorAll('h1 + div [data-slot="badge"]')];
      expect(badges().map((b) => [b.getAttribute('data-variant'), text(b)])).toEqual([
        ['outline', 'Draft'],
        ['secondary', 'Beach volleyball'],
      ]);
      for (const badge of badges()) expectBadgeSize(badge, 'default');
      o.subscription(GET_CAMP)!.emit({ ...CAMP, status: 'published' });
      await o.flush();
      expect(badges().map((b) => [b.getAttribute('data-variant'), text(b)])).toEqual([
        ['default', 'Published'],
        ['secondary', 'Beach volleyball'],
      ]);
    });

    it('lists the age range and the location with its address in a details card', () => {
      expect(text(page.querySelector('#details-heading'))).toBe('Details');
      expect(details()).toEqual([
        ['Age range', ['Ages 9 to 14']],
        [
          'Location',
          ['Pelican Shoals Sand Courts2150 Pelican Shoals Dr, Corpus Christi, TX 78418'],
        ],
      ]);
    });

    it('draws the details, the sessions, and the add form as bare helm cards', () => {
      expectBareCards(main(), [
        'mt-6 max-w-2xl overflow-hidden',
        'mt-4 max-w-2xl overflow-hidden md:mt-6',
        'mt-4 max-w-2xl overflow-clip focus:outline-none md:mt-6',
      ]);
    });
  });

  describe('the sessions', () => {
    it('loading: a skeleton and a polite status inside the card, with the details and the form already there', async () => {
      await open(CAMP);
      expect(text(sessionsCard().querySelector('[role="status"]:not([data-slot])'))).toBe(
        'Loading the sessions.',
      );
      expect(sessionsCard().querySelector('#sessions-list')).toBeNull();
      expect(page.querySelector('#details')).not.toBeNull();
      expect(page.querySelector('#add-session form')).not.toBeNull();
    });

    it('empty: says what will appear and has the link to the form that fills it, which moves focus to Name', async () => {
      await open(CAMP, []);
      expect(text(sessionsCard())).toContain('No sessions yet');
      const add = [...sessionsCard().querySelectorAll<HTMLAnchorElement>('a')].find(
        (a) => text(a) === 'Add a session',
      )!;
      expect(add).toBeDefined();
      expect(add.getAttribute('href')).toBe(`${CAMP_URL}#add-session`);
      expect(add.getAttribute('data-slot')).toBe('button');
      page.querySelector<HTMLElement>('#add-session')!.scrollIntoView = vi.fn();
      add.click();
      await o.flush();
      expect(document.activeElement).toBe(page.querySelector('#add-session #name'));
    });

    it('a failed list shows the destructive alert, never the error message, and the rest of the page stays', async () => {
      await open(CAMP);
      o.subscription(LIST_SESSIONS)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = sessionsCard().querySelector('[role="alert"][data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The sessions could not be loaded.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(page.querySelector('#add-session form')).not.toBeNull();
    });

    it('populated: a row per session in the order given, with its dates, times, places, and deadline', async () => {
      await open(CAMP, SESSIONS);
      expect(items().map((li) => text(li.querySelector('h3')))).toEqual([
        'Week 1',
        'Week 2',
        'Week 3',
      ]);
      const slot = (li: HTMLElement, name: string) =>
        text(li.querySelector(`[data-slot="session-${name}"]`)) ?? null;
      expect(
        items().map((li) => [
          slot(li, 'dates'),
          slot(li, 'times'),
          slot(li, 'places'),
          slot(li, 'deadline'),
        ]),
      ).toEqual([
        ['Jul 5 – Jul 9, 2027', '9 AM to 12 PM', '20 places', 'Registration closes Jul 1, 2027'],
        ['Jul 12 – Jul 16, 2027', '9 AM to 12 PM', '1 place', 'Registration closes Jul 8, 2027'],
        ['Jul 19, 2027', null, '20 places', 'Registration closes Jul 19, 2027'],
      ]);
    });

    it('follows the live list: a session added elsewhere appears at once', async () => {
      await open(CAMP, [SESSIONS[0]]);
      expect(items()).toHaveLength(1);
      o.subscription(LIST_SESSIONS)!.emit(SESSIONS);
      await o.flush();
      expect(items()).toHaveLength(3);
    });

    it('offers Delete on a session with no registrations, and shows the count instead on one with some', async () => {
      await open(CAMP, SESSIONS);
      expect(
        items().map((li) => [
          text(li.querySelector('button')) ?? null,
          text(li.querySelector('[data-slot="session-registered"]')) ?? null,
        ]),
      ).toEqual([
        ['Delete Week 1', null],
        [null, '1 registered'],
        ['Delete Week 3', null],
      ]);
      expect(deleteButton('Week 1').type).toBe('button');
      expect(deleteButton('Week 1').getAttribute('data-slot')).toBe('button');
    });

    describe('Delete and Undo', () => {
      async function remove(name = 'Week 1') {
        deleteButton(name).click();
        await o.flush();
      }

      async function removed() {
        await remove();
        o.convex.calls[0].resolve(null);
        o.subscription(LIST_SESSIONS)!.emit(SESSIONS.slice(1));
        await o.flush();
      }

      beforeEach(() => open(CAMP, SESSIONS));

      it('deletes at once with no dialog, the button saying so while it is in flight', async () => {
        await remove();
        expect(calls()).toEqual([[REMOVE_SESSION, { campSessionId: 'cs_week1' }]]);
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
        expect(text(deleteButton('Week 1'))).toBe('Deleting Week 1…');
        expect(deleteButton('Week 1').getAttribute('aria-disabled')).toBe('true');
        deleteButton('Week 1').click();
        await o.flush();
        expect(o.convex.calls).toHaveLength(1);
      });

      it('says "<name> deleted." with Undo, and moves focus to the status because the button that had it is gone', async () => {
        await removed();
        expect(text(status())).toBe('Week 1 deleted.Undo');
        expect(status().querySelector('[tabindex="-1"]')).toBe(document.activeElement);
        expect(items().map((li) => text(li.querySelector('h3')))).toEqual(['Week 2', 'Week 3']);
      });

      it('Undo adds the session back with the values it had, and says it was restored', async () => {
        await removed();
        undoButton().click();
        await o.flush();
        expect(calls().at(-1)).toEqual([
          ADD_SESSION,
          {
            campId: 'cp_junior',
            name: 'Week 1',
            startDate: '2027-07-05',
            endDate: '2027-07-09',
            dailyStartTime: '09:00',
            dailyEndTime: '12:00',
            places: 20,
            registrationDeadline: '2027-07-01',
          },
        ]);
        o.convex.calls[1].resolve({ campSessionId: 'cs_new' });
        o.subscription(LIST_SESSIONS)!.emit([
          { ...session(), campSessionId: 'cs_new' },
          ...SESSIONS.slice(1),
        ]);
        await o.flush();
        expect(text(status())).toBe('Week 1 restored.');
        expect(items().map((li) => text(li.querySelector('h3')))).toEqual([
          'Week 1',
          'Week 2',
          'Week 3',
        ]);
        expect(status().querySelector('[tabindex="-1"]')).toBe(document.activeElement);
      });

      it('Undo sends no times for a session that had none', async () => {
        await remove('Week 3');
        o.convex.calls[0].resolve(null);
        o.subscription(LIST_SESSIONS)!.emit(SESSIONS.slice(0, 2));
        await o.flush();
        undoButton().click();
        await o.flush();
        expect(o.convex.calls[1].args).toEqual({
          campId: 'cp_junior',
          name: 'Week 3',
          startDate: '2027-07-19',
          endDate: '2027-07-19',
          places: 20,
          registrationDeadline: '2027-07-19',
        });
      });

      it('a failed Undo says so under the status and keeps Undo', async () => {
        await removed();
        undoButton().click();
        await o.flush();
        o.convex.calls[1].reject(new Error('Server Error: secret'));
        await o.flush();
        expect(text(status())).toBe('Week 1 deleted.Undo Week 1 could not be restored. Try again.');
        expect(page.textContent).not.toContain('secret');
        expect(undoButton()).toBeDefined();
      });

      it('shows the server’s own message when it refuses to delete a session with registrations, and keeps the row', async () => {
        await remove();
        o.convex.calls[0].reject(
          new ConvexError({
            code: 'hasRegistrations',
            message: CAMP_SESSION_MESSAGES.hasRegistrations(2),
          }),
        );
        await o.flush();
        const alert = sessionsCard().querySelector<HTMLElement>('[role="alert"]')!;
        expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
          'Week 1 could not be deleted.',
        );
        expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
          CAMP_SESSION_MESSAGES.hasRegistrations(2),
        );
        expect(document.activeElement).toBe(alert);
        expect(items()).toHaveLength(3);
        expect(text(deleteButton('Week 1'))).toBe('Delete Week 1');
      });

      it('any other failure shows the alert with what to do, never the error message', async () => {
        await remove();
        o.convex.calls[0].reject(new Error('Server Error: secret'));
        await o.flush();
        const alert = sessionsCard().querySelector<HTMLElement>('[role="alert"]')!;
        expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
          'Check your connection and try again.',
        );
        expect(page.textContent).not.toContain('secret');
      });

      it('offline: a refusal from the adapter says nothing was removed, and the session stays', async () => {
        await remove();
        o.convex.calls[0].reject(new ConvexOfflineError());
        await o.flush();
        const alert = sessionsCard().querySelector<HTMLElement>('[role="alert"]')!;
        expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
          "You're offline. Nothing was removed.",
        );
        expect(items()).toHaveLength(3);
      });

      it('a later delete replaces the status and clears an earlier alert', async () => {
        await remove();
        o.convex.calls[0].reject(new Error('Server Error'));
        await o.flush();
        await remove('Week 3');
        expect(sessionsCard().querySelector('[role="alert"]')).toBeNull();
      });
    });
  });
});
