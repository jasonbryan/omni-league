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
import { expectPendingSpinner } from '../ui/testing/spinner';
import { radiusClasses } from '../ui/testing/radius-classes';
import { RegisterTournamentTeamPage } from './register-tournament-team-page';

@Component({ template: 'elsewhere' })
class Elsewhere {}

const SLUGS = { orgSlug: 'gulf-coast-sport-social', tournamentSlug: 'gulf-coast-beach-open' };
const URL = `/app/organizations/${SLUGS.orgSlug}/tournaments/${SLUGS.tournamentSlug}/register`;
const TOURNAMENT_PATH = `/organizations/${SLUGS.orgSlug}/tournaments/${SLUGS.tournamentSlug}`;
const GET = 'tournaments:getForRegistration';
const REGISTER = 'teams:registerForTournamentOrWaitlist';
const OPEN = {
  organizationName: 'Gulf Coast Sport & Social',
  name: 'Gulf Coast Beach Open',
  divisionLabel: 'Coed · 2v2 · Open',
  startDate: '2027-06-12',
  endDate: '2027-06-13',
  registrationDeadline: '2027-06-05',
  minimumRosterSize: 2,
  maximumTeams: 16,
  isFull: false,
  team: null,
  waitlist: null,
};
const FULL = { ...OPEN, isFull: true };
const WAITLISTED = { ...FULL, waitlist: { teamName: 'Late Lobsters', position: 2 } };
const ON_TEAM = {
  ...OPEN,
  team: { teamId: 'team_crabs', name: 'Sand Crabs', isCaptain: true, rosterCount: 1 },
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();
/** The title and the description are blocks, so a reader hears them apart. */
const alertText = (element: Element | null | undefined) =>
  [
    element?.querySelector('[data-slot="alert-title"]'),
    element?.querySelector('[data-slot="alert-description"]'),
  ]
    .map(text)
    .join(' ');

describe('RegisterTournamentTeamPage', () => {
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
            path: 'app/organizations/:orgSlug/tournaments/:tournamentSlug/register',
            component: RegisterTournamentTeamPage,
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
      expect(text(page.querySelector('main [role="status"]'))).toBe('Loading the tournament.');
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
      await answer(OPEN);
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
      expect(alertText(card)).toBe(
        'You’re on Sand Crabs in this tournament. Each person plays on one team per tournament, so there’s nothing to register here.',
      );
      const link = [...page.querySelectorAll('main a')].find((a) => text(a) === 'Go to Sand Crabs');
      expect(link?.getAttribute('href')).toBe('/app/teams/team_crabs');
      expect(page.querySelector('form')).toBeNull();
    });

    it('closed: shows the deadline and no form, with a link back to the tournament', async () => {
      await open({ now: '2027-06-06T12:00:00Z' });
      await answer(OPEN);
      const alert = page.querySelector('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('status');
      expectAlertSlots(alert);
      expect(alertText(alert)).toBe(
        'Registration for this tournament is closed. It closed on Jun 5, 2027.',
      );
      expect(page.querySelector('form')).toBeNull();
      const back = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'Back to the tournament page',
      );
      expect(back?.getAttribute('href')).toBe(TOURNAMENT_PATH);
    });

    it('full: the form joins the waitlist, with the waitlist note and button, and calls no mutation', async () => {
      await open();
      await answer(FULL);
      const note = page.querySelector('form [data-slot="alert"]');
      expect(note?.getAttribute('role')).toBe('note');
      expect(note?.hasAttribute('tabindex')).toBe(false);
      expectAlertSlots(note);
      expectAlertClasses(note, 'default');
      expect(alertText(note)).toBe(
        'This tournament is full, so your team joins the waitlist. Waiting teams keep their place in line. If a place opens, an organizer moves a team from the waitlist into the tournament, and you become its captain.',
      );
      expect(text(page.querySelector('#team-name-description'))).toBe(
        'Up to 60 characters. Organizers see it while your team waits; it is not public until the team has a place.',
      );
      expect(text(page.querySelector('button[type="submit"]'))).toBe('Join the waitlist');
      expect(convex.calls).toEqual([]);
    });

    it('waitlisted: the position and a link back to the tournament page, and no form', async () => {
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
        (a) => text(a) === 'Back to the tournament page',
      );
      expect(link?.getAttribute('href')).toBe(TOURNAMENT_PATH);
      expect(page.querySelector('form')).toBeNull();
    });

    it('waitlisted after the deadline: the position, not the closed state', async () => {
      await open({ now: '2027-06-10T00:00:00Z' });
      await answer(WAITLISTED);
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        'Late Lobsters is on the waitlist, position 2.',
      );
      expect(page.textContent).not.toContain('Registration for this tournament is closed.');
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
        'You’re on Sand Crabs in this tournament.',
      );
    });

    it('full and closed: closed wins over full', async () => {
      await open({ now: '2027-06-06T12:00:00Z' });
      await answer(FULL);
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        'Registration for this tournament is closed.',
      );
    });

    it('open: the form with the tournament’s facts and the title', async () => {
      await open();
      await answer(OPEN);
      expect(text(page.querySelector('main h1'))).toBe('Gulf Coast Beach Open');
      const facts = [...page.querySelectorAll('main dl > div')].map((row) => [
        text(row.querySelector('dt')),
        text(row.querySelector('dd')),
      ]);
      expect(facts).toEqual([
        ['Dates', 'Jun 12 – Jun 13, 2027'],
        ['Division', 'Coed · 2v2 · Open'],
        ['Roster', 'At least 2 players'],
        ['Registration closes', 'Jun 5, 2027'],
      ]);
      expect(page.querySelector('label[for="team-name"]')?.textContent?.trim()).toBe('Team name');
      expect(input()?.getAttribute('data-slot')).toBe('input');
      expect(input()?.getAttribute('autocomplete')).toBe('off');
      expect(input()?.getAttribute('aria-describedby')).toBe('team-name-description');
      expect(text(page.querySelector('#team-name-description'))).toBe(
        'Up to 60 characters. Other teams in the tournament see it.',
      );
      expect(document.title).toBe('Register a team | Gulf Coast Beach Open | Omni League');
    });
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

    it('opens the team page when the answer is a team, as when a place opened since the page loaded', async () => {
      await open();
      await answer(FULL);
      await type('Sand Crabs');
      await submit();
      registers()[0].resolve({ status: 'registered', teamId: 'team_crabs' });
      await flush();
      expect(url()).toBe('/app/teams/team_crabs');
    });
  });

  describe('the form', () => {
    beforeEach(async () => {
      await open();
      await answer(OPEN);
    });

    it('an empty submit shows the field error, focuses the field, and sends nothing', async () => {
      await submit();
      expect(text(page.querySelector('#team-name-error'))).toBe('Enter a team name.');
      expect(input()?.getAttribute('aria-invalid')).toBe('true');
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
      await type('Sand Crabs');
      await submit();
      expect(registers().map((call) => call.args)).toEqual([{ ...SLUGS, name: 'Sand Crabs' }]);
      const button = page.querySelector('button[type="submit"]');
      expect(text(button)).toBe('Registering team…');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(button);
      expect(text(page.querySelector('form > p[role="status"]'))).toBe('Registering the team.');
      registers()[0].resolve({ status: 'registered', teamId: 'team_crabs' });
      await flush();
      expect(url()).toBe('/app/teams/team_crabs');
    });

    it('a taken name shows the server’s message under the field and keeps the name', async () => {
      await type('Sand  Crabs');
      await submit();
      registers()[0].reject(
        new ConvexError({
          field: 'name',
          code: 'nameTaken',
          message: 'sand crabs is already registered in this tournament. Choose another name.',
        }),
      );
      await flush();
      expect(text(page.querySelector('#team-name-error'))).toBe(
        'sand crabs is already registered in this tournament. Choose another name.',
      );
      expect(input()?.value).toBe('Sand  Crabs');
      expect(document.activeElement).toBe(input());
    });

    it.each([
      [
        'closed',
        { code: 'registrationClosed', message: 'Registration for this tournament is closed.' },
        'Registration for this tournament is closed.',
      ],
      [
        'on a team',
        {
          code: 'alreadyOnAnotherTeam',
          teamName: 'Sand Crabs',
          message: 'Already on Sand Crabs in this tournament.',
        },
        null,
      ],
    ])('a refusal as %s shows its card, whose alert takes focus', async (_label, data, line) => {
      await type('Net Results');
      await submit();
      registers()[0].reject(new ConvexError(data));
      await flush();
      if (line === null) {
        // The query answers with the caller's team next; until then the form stays.
        expect(registers()).toHaveLength(1);
        await answer(ON_TEAM);
        expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
          'You’re on Sand Crabs in this tournament.',
        );
        return;
      }
      const alert = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toContain(line);
      expect(page.querySelector('form')).toBeNull();
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
          message: "You're on the waitlist with Late Lobsters in this tournament.",
        }),
      );
      await flush();
      const alert = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toContain('Late Lobsters is on the waitlist, position 3.');
      expect(page.querySelector('form')).toBeNull();
      expect(document.activeElement).toBe(alert);
    });

    it('any other failure shows the form alert, focused, and keeps the name', async () => {
      await type('Sand Crabs');
      await submit();
      registers()[0].reject(new Error('network'));
      await flush();
      const alert = page.querySelector<HTMLElement>('form [data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        'The team could not be registered. Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert);
      expect(input()?.value).toBe('Sand Crabs');
    });

    it('offline: refuses with the offline alert, focused, sends nothing, and keeps the name', async () => {
      await type('Sand Crabs');
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
      expect(input()?.value).toBe('Sand Crabs');
      vi.restoreAllMocks();
    });
  });
});
