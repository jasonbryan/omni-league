import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConvexError } from 'convex/values';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { RegisterTeamPage } from './register-team-page';

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
  team: null,
};
const ON_TEAM = {
  ...SUMMER,
  team: { teamId: 'team_sharks', name: 'Sand Sharks', isCaptain: true },
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

    it('closed: shows the deadline and no form', async () => {
      await open({ now: '2027-05-24T12:00:00Z' });
      await answer(SUMMER);
      expect(text(page.querySelector('[data-slot="alert"]'))).toBe(
        'Registration for this season is closed. It closed on May 23, 2027.',
      );
      expect(page.querySelector('form')).toBeNull();
      const back = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'Back to the season page',
      );
      expect(back?.getAttribute('href')).toBe(SEASON_PATH);
    });

    it('closed from the start date when the deadline is on or after it', async () => {
      await open({ now: '2027-06-06T12:00:00Z' });
      await answer({ ...SUMMER, registrationDeadline: '2027-06-10' });
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        'It closed when the season started on Jun 6, 2027.',
      );
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
