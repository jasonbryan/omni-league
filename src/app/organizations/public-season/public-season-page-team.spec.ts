import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { getFunctionName } from 'convex/server';
import { AuthService } from '../../core/auth/auth.service';
import { CONVEX_CLIENT } from '../../core/data/convex';
import { OFFLINE_SAVED_QUERIES } from '../../core/data/convex/offline-saved-queries';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { PublicSeasonPage } from './public-season-page';
import { seasonQueryResults, SUMMER_2027 } from './testing/season-data';

const REGISTRATION = 'seasons:getForRegistration';
const PATH =
  '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s/seasons/summer-2027';
const SLUGS = {
  orgSlug: 'gulf-coast-sport-social',
  leagueSlug: 'sunday-reverse-coed-4s',
  seasonSlug: 'summer-2027',
};
const REGISTER_HREF =
  '/app/register/gulf-coast-sport-social/sunday-reverse-coed-4s/summer-2027/team';

function answer(team: unknown) {
  return {
    organizationName: 'Gulf Coast Sport & Social',
    leagueName: SUMMER_2027.league.name,
    seasonName: SUMMER_2027.name,
    startDate: SUMMER_2027.startDate,
    endDate: SUMMER_2027.endDate,
    registrationDeadline: '2027-05-23',
    formatName: '4v4',
    minimumRosterSize: 4,
    team,
  };
}
const SHARKS = { teamId: 'team_sharks', name: 'Sand Sharks', isCaptain: true, rosterCount: 3 };

let client: FakeConvexClient;

async function open(url = PATH): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
          component: PublicSeasonPage,
        },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  await settle(harness);
  for (const [name, value] of Object.entries(seasonQueryResults())) subscription(name).emit(value);
  await settle(harness);
  return harness;
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

async function signIn(harness: RouterTestingHarness): Promise<void> {
  TestBed.inject(AuthService).onChange(true);
  await settle(harness);
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

const registrations = () => client.activeSubscriptions.filter((s) => s.name === REGISTRATION);
const card = (harness: RouterTestingHarness) =>
  (harness.fixture.nativeElement as HTMLElement).querySelector('#registration');
const spaced = (el: Element | null | undefined) =>
  (el?.innerHTML ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const links = (harness: RouterTestingHarness) =>
  [...(card(harness)?.querySelectorAll('a') ?? [])].map((link) => [
    link.textContent?.replace(/\s+/g, ' ').trim(),
    link.getAttribute('href'),
  ]);

async function showTeam(team: unknown): Promise<RouterTestingHarness> {
  const harness = await open();
  await signIn(harness);
  subscription(REGISTRATION).emit(answer(team));
  await settle(harness);
  return harness;
}

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at('2027-05-01'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("PublicSeasonPage the viewer's team", () => {
  it('opens no getForRegistration subscription for a signed-out visitor, and shows the register actions', async () => {
    const harness = await open();
    expect(registrations()).toHaveLength(0);
    expect(links(harness)).toEqual([['Register a team', REGISTER_HREF]]);
  });

  it("asks once Convex has accepted the sign-in, with the route's slugs only", async () => {
    const harness = await open(`${PATH}?ott=SECRET&page=2`);
    expect(registrations()).toHaveLength(0);
    await signIn(harness);
    expect(registrations().map(({ args }) => args)).toEqual([SLUGS]);
  });

  it('keeps the register actions while the answer is loading', async () => {
    const harness = await open();
    await signIn(harness);
    expect(links(harness)).toEqual([['Register a team', REGISTER_HREF]]);
  });

  it('keeps the register actions for a signed-in visitor on no team', async () => {
    const harness = await showTeam(null);
    expect(spaced(card(harness))).toContain('Registration open · closes May 23, 2027');
    expect(links(harness)).toEqual([['Register a team', REGISTER_HREF]]);
    expect(spaced(card(harness))).not.toContain('registered');
  });

  it('shows a captain below the minimum their team, the roster, Open your team, and the invites still needed', async () => {
    const harness = await showTeam(SHARKS);
    expect(spaced(card(harness))).toBe(
      "Registration You're registered Sand Sharks Captain · 3 of the 4 players needed Open your team Invite one more player before May 23, 2027 to reach the minimum.",
    );
    expect(links(harness)).toEqual([['Open your team', '/app/teams/team_sharks']]);
  });

  it('shows a player on a team that meets the minimum the roster and no invite line', async () => {
    const harness = await showTeam({ ...SHARKS, isCaptain: false, rosterCount: 4 });
    expect(spaced(card(harness))).toBe(
      "Registration You're registered Sand Sharks Player · 4 of the 4 players needed Open your team",
    );
  });

  it('shows the team with no invite line once registration has closed', async () => {
    vi.setSystemTime(at('2027-05-30'));
    const harness = await showTeam(SHARKS);
    expect(spaced(card(harness))).toBe(
      "Registration You're registered Sand Sharks Captain · 3 of the 4 players needed Open your team",
    );
  });

  it('goes back to the register actions on sign-out, and closes the subscription', async () => {
    const harness = await showTeam(SHARKS);
    TestBed.inject(AuthService).onChange(false);
    await settle(harness);
    expect(registrations()).toHaveLength(0);
    expect(links(harness)).toEqual([['Register a team', REGISTER_HREF]]);
  });

  it('keeps the register actions when the answer fails, and the rest of the page shows', async () => {
    const harness = await open();
    await signIn(harness);
    subscription(REGISTRATION).fail(new Error('connect ECONNREFUSED internal-db'));
    await settle(harness);
    expect(links(harness)).toEqual([['Register a team', REGISTER_HREF]]);
    expect((harness.fixture.nativeElement as HTMLElement).querySelector('main h1')).not.toBeNull();
  });

  it('is not on the saved-copy allow-list', () => {
    const names = OFFLINE_SAVED_QUERIES.map(({ query }) => getFunctionName(query));
    expect(names).not.toContain(REGISTRATION);
  });
});
