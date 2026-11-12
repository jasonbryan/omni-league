import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConvexError } from 'convex/values';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { expectAlertClasses, expectAlertSlots } from '../ui/testing/alert';
import { radiusClasses } from '../ui/testing/radius-classes';
import { RegisterTeamPage } from './register-team-page';
import { expectPendingSpinner } from '../ui/testing/spinner';
import { routerLinkState } from '../ui/testing/router-link-state';

@Component({ template: 'elsewhere' })
class Elsewhere {}

const SLUGS = {
  orgSlug: 'gulf-coast-sport-social',
  leagueSlug: 'sunday-reverse-coed-4s',
  seasonSlug: 'summer-2027',
};
const URL = `/app/register/${SLUGS.orgSlug}/${SLUGS.leagueSlug}/${SLUGS.seasonSlug}/team`;
const SEASON_PATH = `/organizations/${SLUGS.orgSlug}/leagues/${SLUGS.leagueSlug}/seasons/${SLUGS.seasonSlug}`;
const GET = 'seasons:getForRegistration';
const REGISTER = 'teams:register';
const SUMMER = {
  organizationName: 'Gulf Coast Sport & Social',
  leagueName: 'Sunday Reverse Coed 4s',
  seasonName: 'Summer 2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
  formatName: '4v4',
  minimumRosterSize: 4,
  isFull: false,
  team: null,
  freeAgent: null,
  waitlist: null,
};
const FULL = { ...SUMMER, isFull: true, maxTeams: 8 };
const WAITLISTED = { ...FULL, waitlist: { teamName: 'Late Lobsters', position: 2 } };
const WAITING = {
  ...SUMMER,
  freeAgent: { status: 'waiting', registeredAt: Date.parse('2027-05-01T00:00:00Z') },
};
const ON_TEAM = {
  ...SUMMER,
  team: { teamId: 'team_sharks', name: 'Sand Sharks', isCaptain: true, rosterCount: 1 },
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

describe('RegisterTeamPage', () => {
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  async function open({ signedIn = true, now = '2027-05-01T00:00:00Z' } = {}) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(now));
    convex = new FakeConvexClient();
    const auth = new FakeAuthClient();
    if (!signedIn) auth.storedCookie = '';
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([
          {
            path: 'app/register/:orgSlug/:leagueSlug/:seasonSlug/team',
            component: RegisterTeamPage,
          },
          { path: 'app/teams/:teamId', component: Elsewhere },
          { path: 'sign-in', component: Elsewhere },
          { path: '**', component: Elsewhere },
        ]),
      ],
    });
    if (signedIn) auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create(URL);
    page = harness.routeNativeElement!;
    await flush();
    if (signedIn) {
      TestBed.inject(AuthService).onChange(true);
      TestBed.tick();
    }
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush() {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
  }

  const registration = () => convex.activeSubscriptions.find((s) => s.name === GET);
  async function answer(value: unknown) {
    registration()!.emit(value);
    await flush();
  }
  const url = () => TestBed.inject(Router).url;
  const input = () => page.querySelector<HTMLInputElement>('#team-name');
  const registers = () => convex.calls.filter((call) => call.name === REGISTER);

  async function type(value: string) {
    const element = input()!;
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
  }

  async function submit() {
    page.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await flush();
  }

  describe('the state order', () => {
    it('asks nothing until Convex has accepted the token, then asks with the slugs', async () => {
      await open();
      expect(registration()?.args).toEqual(SLUGS);
      expect(text(page.querySelector('main [role="status"]'))).toBe('Loading the season.');
    });

    it('while loading, the button placeholder is rounded-lg', async () => {
      await open();
      const button = page.querySelector('[data-testid="register-skeleton"] .pb-6 > div:last-child');
      expect(radiusClasses(button)).toEqual(['rounded-lg']);
    });

    it('not found: shows the not-found view and calls no mutation, signed in or not', async () => {
      for (const signedIn of [true, false]) {
        TestBed.resetTestingModule();
        await open({ signedIn });
        await answer(null);
        expect(text(page.querySelector('main h1'))).toBe('Page not found');
        expect(input()).toBeNull();
        expect(convex.calls).toEqual([]);
        expect(url()).toBe(URL);
      }
    });

    it('signed out: goes to sign-in with this path as returnTo, in place of this entry', async () => {
      await open({ signedIn: false });
      expect(registration()?.args).toEqual(SLUGS);
      await answer(SUMMER);
      expect(url()).toBe(`/sign-in?returnTo=${encodeURIComponent(URL)}`);
      expect(convex.calls).toEqual([]);
    });

    it('on a team after the deadline: says so with a link to the team, and no form', async () => {
      await open({ now: '2027-06-10T00:00:00Z' });
      await answer(ON_TEAM);
      const card = page.querySelector('[data-slot="alert"]');
      expect(card?.getAttribute('role')).toBe('status');
      expectAlertSlots(card);
      expectAlertClasses(card, 'default');
      expect(text(card)).toBe(
        'You’re on Sand Sharks in this season. Each person plays on one team per season, so there’s nothing to register here.',
      );
      const link = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'Go to Sand Sharks',
      );
      expect(link?.getAttribute('href')).toBe('/app/teams/team_sharks');
      expect(page.querySelector('form')).toBeNull();
      expect(page.textContent).not.toContain('Registration for this season is closed.');
    });

    it('a waiting free agent: says so with a link to the free-agent route, and no form', async () => {
      await open({ now: '2027-05-30T00:00:00Z' });
      await answer(WAITING);
      const card = page.querySelector('[data-slot="alert"]');
      expect(card?.getAttribute('role')).toBe('status');
      expect(text(card)).toBe(
        "You’re waiting to be placed on a team. You're registered as a free agent in this season. An organizer places free agents on teams.",
      );
      const link = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'View your free-agent registration',
      );
      expect(link?.getAttribute('href')).toBe(
        `/app/register/${SLUGS.orgSlug}/${SLUGS.leagueSlug}/${SLUGS.seasonSlug}/free-agent`,
      );
      expect(page.querySelector('form')).toBeNull();
    });

    it('closed: shows the deadline and no form', async () => {
      await open({ now: '2027-05-24T12:00:00Z' });
      await answer(SUMMER);
      expect(text(page.querySelector('[data-slot="alert"]'))).toBe(
        'Registration for this season is closed. It closed on May 23, 2027.',
      );
      expectAlertSlots(page.querySelector('[data-slot="alert"]'));
      expectAlertClasses(page.querySelector('[data-slot="alert"]'), 'default');
      expect(page.querySelector('form')).toBeNull();
      const back = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'Back to the season page',
      );
      expect(back?.getAttribute('href')).toBe(SEASON_PATH);
    });

    it('closed: sets no navigation state on the links to the season page, so its skeleton shows the bars', async () => {
      await open({ now: '2027-05-24T12:00:00Z' });
      await answer(SUMMER);
      const links = [...page.querySelectorAll('main a')].filter(
        (a) => a.getAttribute('href') === SEASON_PATH,
      );

      expect(links).toHaveLength(2);
      expect(links.map((link) => routerLinkState(harness.fixture, link))).toEqual([
        undefined,
        undefined,
      ]);
    });

    it('closed from the start date when the deadline is on or after it', async () => {
      await open({ now: '2027-06-06T12:00:00Z' });
      await answer({ ...SUMMER, registrationDeadline: '2027-06-10' });
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        'It closed when the season started on Jun 6, 2027.',
      );
    });

    it('full: the form joins the waitlist, with the waitlist note and button, and calls no mutation', async () => {
      await open();
      await answer(FULL);
      const note = page.querySelector('form [data-slot="alert"]');
      expect(note?.getAttribute('role')).toBe('note');
      expect(note?.hasAttribute('tabindex')).toBe(false);
      expectAlertSlots(note);
      expectAlertClasses(note, 'default');
      expect(text(note)).toBe(
        'This season is full, so your team joins the waitlist. Waiting teams keep their place in line. If a place opens, an organizer moves a team from the waitlist into the season, and you become its captain.',
      );
      expect(text(page.querySelector('#team-name-description'))).toBe(
        'Up to 60 characters. Organizers see it while your team waits; it is not public until the team has a place.',
      );
      expect(text(page.querySelector('button[type="submit"]'))).toBe('Join the waitlist');
      expect(convex.calls).toEqual([]);
    });

    it('waitlisted: the position and a link back to the season page, and no form', async () => {
      await open();
      await answer(WAITLISTED);
      const card = page.querySelector('[data-slot="alert"]');
      expect(card?.getAttribute('role')).toBe('status');
      expectAlertSlots(card);
      expectAlertClasses(card, 'default', 'outline-offset-2 focus:outline-2 focus:outline-ring');
      expect(text(card)).toBe(
        'Late Lobsters is on the waitlist, position 2. One team is ahead of yours. If an organizer gives your team a place, it appears under Your teams, and you can invite your players.',
      );
      const link = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'Back to the season page',
      );
      expect(link?.getAttribute('href')).toBe(SEASON_PATH);
      expect(page.querySelector('form')).toBeNull();
    });

    it('waitlisted: sets no navigation state on the links to the season page', async () => {
      await open();
      await answer(WAITLISTED);
      const links = [...page.querySelectorAll('main a')].filter(
        (a) => a.getAttribute('href') === SEASON_PATH,
      );

      expect(links).toHaveLength(2);
      expect(links.map((link) => routerLinkState(harness.fixture, link))).toEqual([
        undefined,
        undefined,
      ]);
    });

    it('waitlisted after the deadline: the position, not the closed state', async () => {
      await open({ now: '2027-06-10T00:00:00Z' });
      await answer(WAITLISTED);
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        'Late Lobsters is on the waitlist, position 2.',
      );
      expect(page.textContent).not.toContain('Registration for this season is closed.');
    });

    it.each([
      [1, 'Your team is first in line.'],
      [4, '3 teams are ahead of yours.'],
    ])('waitlisted at position %s says how many teams are ahead', async (position, ahead) => {
      await open();
      await answer({ ...FULL, waitlist: { teamName: 'Late Lobsters', position } });
      expect(text(page.querySelector('[data-slot="alert-description"]'))).toContain(ahead);
    });

    it('full and on a team: "You’re on <team>" wins over full', async () => {
      await open();
      await answer({ ...FULL, team: ON_TEAM.team });
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        'You’re on Sand Sharks in this season.',
      );
      expect(page.textContent).not.toContain('This season is full.');
    });

    it('full and closed: closed wins over full', async () => {
      await open({ now: '2027-05-24T12:00:00Z' });
      await answer(FULL);
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        'Registration for this season is closed.',
      );
      expect(page.textContent).not.toContain('This season is full.');
    });

    it('open: the form with the season’s facts and the title', async () => {
      await open();
      await answer(SUMMER);
      expect(text(page.querySelector('main h1'))).toBe('Sunday Reverse Coed 4s, Summer 2027');
      const facts = [...page.querySelectorAll('main dl > div')].map((row) => [
        text(row.querySelector('dt')),
        text(row.querySelector('dd')),
      ]);
      expect(facts).toEqual([
        ['Dates', 'Jun 6 – Aug 29, 2027'],
        ['Format', '4v4'],
        ['Roster', 'At least 4 players'],
        ['Registration closes', 'May 23, 2027'],
      ]);
      expect(page.querySelector('label[for="team-name"]')?.textContent?.trim()).toBe('Team name');
      expect(input()?.getAttribute('data-slot')).toBe('input');
      expect(input()?.getAttribute('autocomplete')).toBe('off');
      expect(input()?.getAttribute('aria-describedby')).toBe('team-name-description');
      expect(document.title).toBe('Register a team | Summer 2027 | Omni League');
    });
  });

  it('open with a maximum roster size: the roster row gives the range', async () => {
    await open();
    await answer({ ...SUMMER, maxRosterSize: 6 });
    const roster = [...page.querySelectorAll('main dl > div')].find(
      (row) => text(row.querySelector('dt')) === 'Roster',
    );
    expect(text(roster?.querySelector('dd'))).toBe('4 to 6 players');
  });

  describe('joining the waitlist', () => {
    it('shows the pending state, then the position in a status that takes focus, on the same route', async () => {
      await open();
      await answer(FULL);
      await type(' Late   Lobsters ');
      await submit();
      expect(registers().map((call) => call.args)).toEqual([
        { ...SLUGS, name: ' Late   Lobsters ' },
      ]);
      expect(text(page.querySelector('button[type="submit"]'))).toBe('Joining the waitlist…');
      expectPendingSpinner(page.querySelector('button[type="submit"]'));
      expect(text(page.querySelector('form > p[role="status"]'))).toBe('Joining the waitlist.');
      registers()[0].resolve({ status: 'waitlisted', position: 1 });
      await flush();
      const status = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(status?.getAttribute('role')).toBe('status');
      expect(text(status)).toContain('Late Lobsters is on the waitlist, position 1.');
      expect(document.activeElement).toBe(status);
      expect(url()).toBe(URL);
    });
  });

  describe('the form', () => {
    beforeEach(async () => {
      await open();
      await answer(SUMMER);
    });

    it('an empty submit shows the field error, focuses the field, and sends nothing', async () => {
      await submit();
      expect(text(page.querySelector('#team-name-error'))).toBe('Enter a team name.');
      expect(input()?.getAttribute('aria-invalid')).toBe('true');
      expect(input()?.getAttribute('aria-describedby')).toBe(
        'team-name-description team-name-error',
      );
      expect(document.activeElement).toBe(input());
      expect(registers()).toEqual([]);
    });

    it('a 61-character name shows the count once the field is left', async () => {
      await type('a'.repeat(61));
      expect(page.querySelector('#team-name-error')).toBeNull();
      input()!.dispatchEvent(new Event('blur'));
      await flush();
      expect(text(page.querySelector('#team-name-error'))).toBe(
        'Use 60 characters or fewer. This name has 61.',
      );
    });

    it('sends the slugs and the name, shows the pending state, then opens the team page', async () => {
      await type('Sand Sharks');
      await submit();
      expect(registers().map((call) => call.args)).toEqual([{ ...SLUGS, name: 'Sand Sharks' }]);
      const button = page.querySelector('button[type="submit"]');
      expect(text(button)).toBe('Registering team…');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(button);
      expect(text(page.querySelector('form > p[role="status"]'))).toBe('Registering the team.');
      registers()[0].resolve({ status: 'registered', teamId: 'team_sharks' });
      await flush();
      expect(url()).toBe('/app/teams/team_sharks');
    });

    it('a taken name shows the server’s message under the field and keeps the name', async () => {
      await type('Sand  Sharks');
      await submit();
      registers()[0].reject(
        new ConvexError({
          field: 'name',
          code: 'nameTaken',
          message: 'sand sharks is already registered in this season. Choose another name.',
        }),
      );
      await flush();
      expect(text(page.querySelector('#team-name-error'))).toBe(
        'sand sharks is already registered in this season. Choose another name.',
      );
      expect(input()?.value).toBe('Sand  Sharks');
      expect(document.activeElement).toBe(input());
    });

    it('a refusal as closed shows the closed card, whose alert takes focus', async () => {
      await type('Sand Sharks');
      await submit();
      registers()[0].reject(
        new ConvexError({
          code: 'registrationClosed',
          message: 'Registration for this season is closed.',
        }),
      );
      await flush();
      const alert = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toContain('Registration for this season is closed.');
      expect(document.activeElement).toBe(alert);
    });

    it('a refusal as on the waitlist shows the waitlisted card, whose alert takes focus', async () => {
      await type('Second Try');
      await submit();
      registers()[0].reject(
        new ConvexError({
          code: 'onWaitlist',
          teamName: 'Late Lobsters',
          position: 3,
          message: "You're on the waitlist with Late Lobsters in this season.",
        }),
      );
      await flush();
      const alert = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toContain('Late Lobsters is on the waitlist, position 3.');
      expect(page.querySelector('form')).toBeNull();
      expect(document.activeElement).toBe(alert);
    });

    it('a refusal as a waiting free agent shows the waiting card, whose alert takes focus', async () => {
      await type('Sand Sharks');
      await submit();
      registers()[0].reject(
        new ConvexError({
          code: 'waitingFreeAgent',
          message: "You're registered as a free agent in this season.",
        }),
      );
      await flush();
      const alert = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toContain('You’re waiting to be placed on a team.');
      expect(page.querySelector('form')).toBeNull();
      expect(document.activeElement).toBe(alert);
    });

    it('any other failure shows the form alert, focused, and keeps the name', async () => {
      await type('Sand Sharks');
      await submit();
      registers()[0].reject(new Error('network'));
      await flush();
      const alert = page.querySelector<HTMLElement>('form [data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        'The team could not be registered. Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert);
      expect(input()?.value).toBe('Sand Sharks');
    });

    it('offline: refuses with the offline alert, focused, sends nothing, and keeps the name', async () => {
      await type('Sand Sharks');
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await harness.fixture.whenStable();
      const button = page.querySelector('button[type="submit"]');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expect(button?.classList.contains('opacity-50')).toBe(true);
      await submit();
      expect(registers()).toEqual([]);
      const alert = page.querySelector<HTMLElement>('form [data-slot="alert"]');
      expect(text(alert)).toBe(
        "You're offline. Nothing was sent. Your team name is still here. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(alert);
      expect(input()?.value).toBe('Sand Sharks');
      vi.restoreAllMocks();
    });
  });
});
