import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConvexError } from 'convex/values';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { RegisterFreeAgentPage } from './register-free-agent-page';

@Component({ template: 'elsewhere' })
class Elsewhere {}

const SLUGS = {
  orgSlug: 'gulf-coast-sport-social',
  leagueSlug: 'sunday-reverse-coed-4s',
  seasonSlug: 'summer-2027',
};
const URL = `/app/register/${SLUGS.orgSlug}/${SLUGS.leagueSlug}/${SLUGS.seasonSlug}/free-agent`;
const SEASON_PATH = `/organizations/${SLUGS.orgSlug}/leagues/${SLUGS.leagueSlug}/seasons/${SLUGS.seasonSlug}`;
const GET = 'seasons:getForRegistration';
const REGISTER = 'freeAgents:register';
const REGISTERED_AT = Date.parse('2026-10-10T15:00:00Z');
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
const SHARKS = { teamId: 'team_sharks', name: 'Sand Sharks', isCaptain: false, rosterCount: 4 };
const WAITING = { ...SUMMER, freeAgent: { status: 'waiting', registeredAt: REGISTERED_AT } };
const PLACED = {
  ...SUMMER,
  team: SHARKS,
  freeAgent: { status: 'placed', registeredAt: REGISTERED_AT },
};
const AFTER_DEADLINE = '2027-05-30T00:00:00Z';

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

describe('RegisterFreeAgentPage', () => {
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
            path: 'app/register/:orgSlug/:leagueSlug/:seasonSlug/free-agent',
            component: RegisterFreeAgentPage,
          },
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
  const registers = () => convex.calls.filter((call) => call.name === REGISTER);
  const cardAlert = () => page.querySelector<HTMLElement>('[data-slot="alert"]');
  const linkNamed = (name: string) =>
    [...page.querySelectorAll('main a')].find((a) => text(a) === name);

  async function submit() {
    page.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await flush();
  }

  describe('the state order', () => {
    it('not found: shows the not-found view and calls no mutation, signed in or not', async () => {
      for (const signedIn of [true, false]) {
        TestBed.resetTestingModule();
        await open({ signedIn });
        await answer(null);
        expect(text(page.querySelector('main h1'))).toBe('Page not found');
        expect(page.querySelector('form')).toBeNull();
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

    it('a placed free agent after the deadline: the on-a-team state with the team link, not closed', async () => {
      await open({ now: AFTER_DEADLINE });
      await answer(PLACED);
      expect(text(cardAlert())).toBe(
        'You’re on Sand Sharks in this season. Each person plays on one team per season, so there’s no need to register as a free agent.',
      );
      expect(linkNamed('Go to Sand Sharks')?.getAttribute('href')).toBe('/app/teams/team_sharks');
      expect(page.querySelector('form')).toBeNull();
      expect(page.textContent).not.toContain('Registration for this season is closed.');
    });

    it('a waiting free agent after the deadline: the waiting state with the date, not closed', async () => {
      await open({ now: AFTER_DEADLINE });
      await answer(WAITING);
      expect(cardAlert()?.getAttribute('role')).toBe('status');
      expect(text(cardAlert())).toBe(
        'You’re registered as a free agent. An organizer will place you on a team. It will then appear under Your teams. Registered Oct 10, 2026.',
      );
      expect(linkNamed('Back to the season page')?.getAttribute('href')).toBe(SEASON_PATH);
      expect(page.querySelector('form')).toBeNull();
      expect(page.textContent).not.toContain('Registration for this season is closed.');
    });

    it('a waiting captain: the waitlist position with a link to the team route, and no form', async () => {
      await open();
      await answer({
        ...SUMMER,
        isFull: true,
        waitlist: { teamName: 'Late Lobsters', position: 2 },
      });
      expect(cardAlert()?.getAttribute('role')).toBe('status');
      expect(text(cardAlert())).toBe(
        'You’re on the waitlist with Late Lobsters, position 2. While your team waits, you can’t also register as a free agent in this season.',
      );
      expect(linkNamed('See your waitlist place')?.getAttribute('href')).toBe(
        URL.replace(/free-agent$/, 'team'),
      );
      expect(page.querySelector('form')).toBeNull();
    });

    it('neither after the deadline: the closed state with the deadline and no form', async () => {
      await open({ now: AFTER_DEADLINE });
      await answer(SUMMER);
      expect(text(cardAlert())).toBe(
        'Registration for this season is closed. It closed on May 23, 2027. To play on a team that has already registered, ask its captain for an invite.',
      );
      expect(page.querySelector('form')).toBeNull();
    });

    it('open: the season’s facts, the button, and the title', async () => {
      await open();
      await answer(SUMMER);
      expect(text(page.querySelector('main h1'))).toBe('Sunday Reverse Coed 4s, Summer 2027');
      expect(text(page.querySelector('main h1')?.previousElementSibling)).toBe(
        'Register as a free agent',
      );
      expect(text(page.querySelector('form p'))).toBe(
        'You register on your own, and an organizer places you on a team that needs players. You’re not on a roster, and owe nothing, until then.',
      );
      expect(text(page.querySelector('button[type="submit"]'))).toBe('Register as a free agent');
      expect(document.title).toBe('Register as a free agent | Summer 2027 | Omni League');
    });

    it('open: the roster row gives the range under a maximum roster size, and the minimum without one', async () => {
      await open();
      await answer({ ...SUMMER, maxRosterSize: 6 });
      const roster = () =>
        [...page.querySelectorAll('main dl > div')].find(
          (row) => text(row.querySelector('dt')) === 'Roster',
        );
      expect(text(roster()?.querySelector('dd'))).toBe('4 to 6 players');
      await answer(SUMMER);
      expect(text(roster()?.querySelector('dd'))).toBe('At least 4 players');
    });

    it('a full season still offers the form: the maximum limits teams, not free agents', async () => {
      await open();
      await answer({ ...SUMMER, isFull: true, maxTeams: 2 });
      expect(text(page.querySelector('button[type="submit"]'))).toBe('Register as a free agent');
    });
  });

  describe('registering', () => {
    beforeEach(async () => {
      await open();
      await answer(SUMMER);
    });

    it('sends the slugs, shows the pending state, then the waiting status, focused', async () => {
      await submit();
      expect(registers().map((call) => call.args)).toEqual([SLUGS]);
      const button = page.querySelector('button[type="submit"]');
      expect(text(button)).toBe('Registering…');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expect(text(page.querySelector('form > p[role="status"]'))).toBe(
        'Registering you as a free agent.',
      );
      registers()[0].resolve({ status: 'waiting', registeredAt: REGISTERED_AT });
      await flush();
      expect(text(cardAlert())).toContain('You’re registered as a free agent.');
      expect(text(cardAlert())).toContain('Registered Oct 10, 2026.');
      expect(document.activeElement).toBe(cardAlert());
      expect(url()).toBe(URL);
    });

    it('a refusal as already registered shows the waiting status, focused', async () => {
      await submit();
      registers()[0].reject(
        new ConvexError({
          code: 'alreadyFreeAgent',
          message: 'Already registered as a free agent in this season.',
        }),
      );
      await flush();
      expect(text(cardAlert())).toContain('You’re registered as a free agent.');
      expect(document.activeElement).toBe(cardAlert());
    });

    it('a refusal as closed shows the closed card, whose alert takes focus', async () => {
      await submit();
      registers()[0].reject(
        new ConvexError({
          code: 'registrationClosed',
          message: 'Registration for this season is closed.',
        }),
      );
      await flush();
      expect(cardAlert()?.getAttribute('role')).toBe('alert');
      expect(text(cardAlert())).toContain('Registration for this season is closed.');
      expect(document.activeElement).toBe(cardAlert());
    });

    it('any other failure shows the form alert, focused, and keeps the button', async () => {
      await submit();
      registers()[0].reject(new Error('network'));
      await flush();
      const alert = page.querySelector<HTMLElement>('form [data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe('You could not be registered. Check your connection and try again.');
      expect(document.activeElement).toBe(alert);
      expect(text(page.querySelector('button[type="submit"]'))).toBe('Register as a free agent');
    });

    it('offline: refuses with the offline alert, focused, and sends nothing', async () => {
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
        "You're offline. Nothing was sent. You're not registered yet. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(alert);
      vi.restoreAllMocks();
    });
  });
});
