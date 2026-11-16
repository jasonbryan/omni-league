import type { Routes } from '@angular/router';
import { COASTAL, Elsewhere, openAdmin, text } from './testing/admin-harness';
import { TournamentPage } from './tournament-page';

const ROUTES: Routes = [
  { path: 'app/organizations/:orgSlug/tournaments/:tournamentSlug', component: TournamentPage },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];
const URL = `/app/organizations/${COASTAL.slug}/tournaments/winter-doubles-classic`;
const GET = 'tournaments:getForManagement';
const POOLS = 'tournamentGames:getPools';
const ENTER = 'tournamentGames:enterResult';
const CORRECT = 'tournamentGames:correctResult';
const UNDO = 'tournamentGames:undoResult';
const CONFIRM = 'scoreReports:confirm';

const TOURNAMENT = {
  tournamentId: 'tn_winter',
  organizationId: COASTAL.organizationId,
  role: 'orgAdmin',
  status: 'published',
  organization: { name: COASTAL.name, slug: COASTAL.slug },
  name: 'Winter Doubles Classic',
  slug: 'winter-doubles-classic',
  sportName: 'Soccer',
  divisionLabel: 'Coed · 2v2 · Open',
  locations: [],
  minimumRosterSize: 2,
  maximumTeams: 16,
  sport: 'soccer',
  teamCount: 6,
  setsPerGame: 1,
  bracketCreated: false,
  poolGamesCreated: true,
  structure: 'pools',
  startDate: '2025-01-16',
  endDate: '2025-01-17',
  registrationDeadline: '2025-01-09',
};
const BEACH = { ...TOURNAMENT, sport: 'beachVolleyball', sportName: 'Beach volleyball' };

const team = (seed: number) => ({
  teamId: `tm_${seed}`,
  name: `Team ${String(seed).padStart(2, '0')}`,
});
const withRoster = (seed: number) => ({ ...team(seed), rosterCount: 2, seed });

interface Result {
  score: unknown;
  forfeitTeamId: string | null;
  resultEnteredAt: number;
}

interface Reported {
  reportId: string;
  teamId: string;
  teamName: string;
  score: unknown;
  reportedAt: number;
}

function poolsOf(
  result: Result | null = null,
  winnerTeamId: string | null = null,
  reports: Reported[] = [],
) {
  return {
    confirmedCount: 6,
    unconfirmedCount: 0,
    pools: [
      {
        pool: 'A',
        teams: [1, 4, 5].map(withRoster),
        games: [
          {
            gameId: 'g_1',
            round: 1,
            slot: 1,
            teams: [team(1), team(4)],
            winnerTeamId,
            result,
            reports: [],
          },
          {
            gameId: 'g_2',
            round: 2,
            slot: 1,
            teams: [team(1), team(5)],
            winnerTeamId: null,
            result: null,
            reports,
          },
        ],
      },
    ],
    seeds: [1, 4, 5].map(withRoster),
    unassigned: [],
    gamesCreated: true,
    gamesCurrent: true,
    hasResult: result !== null,
  };
}

const goals = (a: number, b: number) => ({ kind: 'goals', a, b });
const stored = (score: object, at = 1_000): Result => ({
  score,
  forfeitTeamId: null,
  resultEnteredAt: at,
});

describe('Pool game results', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(pools: unknown = poolsOf(), tournament: object = TOURNAMENT) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(tournament);
    await o.flush();
    o.subscription('waitlist:listForTournament')?.emit({ rows: [], waitlistCount: 0 });
    await o.flush();
    o.subscription(POOLS)?.emit(pools);
    await o.flush();
  }

  const row = (gameId: string) =>
    page.querySelector<HTMLElement>(`#pools [data-game="${gameId}"]`)!;
  const button = (gameId: string, label: string) =>
    [...row(gameId).querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    );
  const input = (gameId: string, name: string) =>
    row(gameId).querySelector<HTMLInputElement>(`#${gameId}-${name}`)!;
  const error = (gameId: string, name: string) =>
    text(row(gameId).querySelector(`#${gameId}-${name}-error`)) ?? null;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function type(gameId: string, name: string, value: string) {
    const field = input(gameId, name);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function leave(gameId: string, name: string) {
    input(gameId, name).dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
    );
    await o.harness.fixture.whenStable();
  }

  async function press(target: HTMLElement | undefined) {
    target!.click();
    await o.flush();
  }

  async function fill(gameId: string, a: string, b: string) {
    await type(gameId, 'a1', a);
    await type(gameId, 'b1', b);
  }

  it('labels each game with its round, and offers Enter result on a game that has none', async () => {
    await open();
    expect(
      [...page.querySelectorAll('#pools [data-slot="game-label"]')].map((label) => text(label)),
    ).toEqual(['Round 1: Team 01 v Team 04', 'Round 2: Team 01 v Team 05']);
    expect(text(button('g_1', 'Enter result'))).toBe('Enter result Team 01 v Team 04');
  });

  it('takes a tied score in soccer, with no error under the pair of scores', async () => {
    await open();
    await press(button('g_1', 'Enter result'));
    await fill('g_1', '2', '2');
    await leave('g_1', 'b1');
    expect(error('g_1', 'score')).toBeNull();
    await press(button('g_1', 'Save result'));
    expect(calls()).toEqual([[ENTER, { gameId: 'g_1', score: goals(2, 2) }]]);
  });

  it('says a saved tie ended in a tie, and shows the game as tied', async () => {
    await open();
    await press(button('g_1', 'Enter result'));
    await fill('g_1', '2', '2');
    await press(button('g_1', 'Save result'));
    o.convex.calls[0].resolve({
      winnerTeamId: null,
      winnerName: null,
      advancesTo: null,
      previous: null,
      resultEnteredAt: 1_000,
    });
    o.subscription(POOLS)!.emit(poolsOf(stored(goals(2, 2))));
    await o.flush();
    const alert = row('g_1').querySelector('[data-slot="alert"]')!;
    expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('Result saved');
    expect(text(alert.querySelector('[data-slot="alert-description"]'))).toContain(
      'The game ended in a tie.',
    );
    expect(text(row('g_1').querySelector('[data-slot="game-result"]'))).toBe(
      'Team 01 2–2 Team 04. The game was tied.',
    );
  });

  it('says a saved win names the winner and no round the winner joins', async () => {
    await open();
    await press(button('g_1', 'Enter result'));
    await fill('g_1', '3', '1');
    await press(button('g_1', 'Save result'));
    o.convex.calls[0].resolve({
      winnerTeamId: 'tm_1',
      winnerName: 'Team 01',
      advancesTo: null,
      previous: null,
      resultEnteredAt: 1_000,
    });
    o.subscription(POOLS)!.emit(poolsOf(stored(goals(3, 1)), 'tm_1'));
    await o.flush();
    const alert = row('g_1').querySelector('[data-slot="alert"]')!;
    const description = text(alert.querySelector('[data-slot="alert-description"]'));
    expect(description).toContain('Team 01 won.');
    expect(description).not.toContain('advances');
    expect(description).not.toContain('tournament');
    expect(text(row('g_1').querySelector('[data-slot="game-result"]'))).toBe(
      'Team 01 3–1 Team 04. Team 01 won.',
    );
  });

  it('refuses a tied set in beach volleyball, under the set, and sends nothing', async () => {
    await open(poolsOf(), BEACH);
    await press(button('g_1', 'Enter result'));
    await fill('g_1', '21', '21');
    await press(button('g_1', 'Save result'));
    expect(error('g_1', 'set1')).toBe('Set 1 is tied. A set needs a winner.');
    expect(calls()).toEqual([]);
  });

  it('offers Correct result and Clear result on a played game, and a game with no next game is never locked', async () => {
    await open(poolsOf(stored(goals(2, 2))));
    expect(button('g_1', 'Correct result')).toBeDefined();
    expect(button('g_1', 'Clear result')).toBeDefined();
    expect(row('g_1').querySelector('[data-slot="locked"]')).toBeNull();
  });

  it('once the bracket exists shows why a played pool game cannot change, in place of Correct result and Clear result', async () => {
    const pools = poolsOf(stored(goals(2, 2)));
    await open({
      ...pools,
      pools: pools.pools.map((pool) => ({
        ...pool,
        games: pool.games.map((game) => ({ ...game, locked: true })),
      })),
    });
    expect(text(row('g_1').querySelector('[data-slot="locked"]'))).toBe(
      'The bracket is created, so pool results cannot change.',
    );
    expect(row('g_1').textContent).not.toContain('Correct result');
    expect(row('g_1').textContent).not.toContain('Clear result');
  });

  it('corrects a tied result to a win', async () => {
    await open(poolsOf(stored(goals(2, 2))));
    await press(button('g_1', 'Correct result'));
    expect(input('g_1', 'a1').value).toBe('2');
    await fill('g_1', '3', '2');
    await press(button('g_1', 'Save correction'));
    expect(calls()).toEqual([[CORRECT, { gameId: 'g_1', score: goals(3, 2) }]]);
  });

  it('clears a tied result and enters the tie again with Undo', async () => {
    await open(poolsOf(stored(goals(2, 2))));
    await press(button('g_1', 'Clear result'));
    expect(calls()).toEqual([[UNDO, { gameId: 'g_1', expected: 1_000 }]]);
    o.convex.calls[0].resolve(null);
    o.subscription(POOLS)!.emit(poolsOf());
    await o.flush();
    await press(button('g_1', 'Undo'));
    expect(calls()[1]).toEqual([ENTER, { gameId: 'g_1', score: goals(2, 2) }]);
  });

  describe('a pool game with a captain’s report', () => {
    const report = (teamName: string, a: number, b: number, reportedAt = 2_345): Reported => ({
      reportId: `sr_${teamName}`,
      teamId: teamName === 'Team 01' ? 'tm_1' : 'tm_5',
      teamName,
      score: goals(a, b),
      reportedAt,
    });
    const REPORTED = (...reports: Reported[]) => poolsOf(null, null, reports);
    const SAVED_WIN = {
      winnerTeamId: 'tm_1',
      winnerName: 'Team 01',
      advancesTo: null,
      previous: null,
      resultEnteredAt: 5_000,
    };

    it('reads Reported with the team’s score, Confirm and Correct score, and no Enter result', async () => {
      await open(REPORTED(report('Team 05', 1, 3)));
      expect(text(row('g_2').querySelector('[data-slot="reports"] [data-slot="badge"]'))).toBe(
        'Reported',
      );
      expect(text(row('g_2').querySelector('[data-slot="report"] span'))).toBe(
        'Team 05 reported Team 01 1–3 Team 05.',
      );
      expect(text(button('g_2', 'Confirm'))).toBe('Confirm the score reported by Team 05');
      expect(text(button('g_2', 'Correct score'))).toBe('Correct score Team 01 v Team 05');
      expect(button('g_2', 'Enter result')).toBeUndefined();
      expect(button('g_1', 'Enter result')).toBeDefined();
    });

    it('Confirm sends the report and the time it was shown', async () => {
      await open(REPORTED(report('Team 05', 1, 3, 2_345)));
      await press(button('g_2', 'Confirm'));
      expect(calls()).toEqual([[CONFIRM, { reportId: 'sr_Team 05', expected: 2_345 }]]);
    });

    it('says a confirmed win names the winner and no round or tournament', async () => {
      await open(REPORTED(report('Team 01', 3, 1)));
      await press(button('g_2', 'Confirm'));
      o.convex.calls[0].resolve(SAVED_WIN);
      o.subscription(POOLS)!.emit(poolsOf());
      await o.flush();
      const alert = row('g_2').querySelector('[data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('Report confirmed');
      const description = text(alert.querySelector('[data-slot="alert-description"]'));
      expect(description).toContain('Team 01 won.');
      expect(description).not.toContain('tournament');
      expect(description).not.toContain('advances');
    });

    it('says a confirmed tie ended in a tie', async () => {
      await open(REPORTED(report('Team 01', 2, 2)));
      await press(button('g_2', 'Confirm'));
      o.convex.calls[0].resolve({ ...SAVED_WIN, winnerTeamId: null, winnerName: null });
      o.subscription(POOLS)!.emit(poolsOf());
      await o.flush();
      expect(
        text(row('g_2').querySelector('[data-slot="alert"] [data-slot="alert-description"]')),
      ).toContain('The game ended in a tie.');
    });

    it('Correct score opens the form with a lone report’s score, and a tie is accepted in soccer', async () => {
      await open(REPORTED(report('Team 05', 2, 2)));
      await press(button('g_2', 'Correct score'));
      expect(input('g_2', 'a1').value).toBe('2');
      expect(input('g_2', 'b1').value).toBe('2');
      await press(button('g_2', 'Save result'));
      expect(calls()).toEqual([[ENTER, { gameId: 'g_2', score: goals(2, 2) }]]);
    });
  });
});
