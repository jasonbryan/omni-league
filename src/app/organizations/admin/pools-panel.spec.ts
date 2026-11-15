import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import type { Routes } from '@angular/router';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { TournamentPage } from './tournament-page';
import { COASTAL, Elsewhere, openAdmin, text } from './testing/admin-harness';

const ROUTES: Routes = [
  { path: 'app/organizations/:orgSlug/tournaments/:tournamentSlug', component: TournamentPage },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];
const URL = `/app/organizations/${COASTAL.slug}/tournaments/winter-doubles-classic`;
const GET = 'tournaments:getForManagement';
const LIST_WAITLIST = 'waitlist:listForTournament';
const POOLS = 'tournamentGames:getPools';
const SETUP = 'tournamentGames:getSetup';
const SPLIT = 'tournamentGames:splitPools';
const MOVE = 'tournamentGames:movePoolTeam';
const UNDO_SPLIT = 'tournamentGames:undoSplitPools';
const MOVE_SEED = 'tournamentGames:moveSeed';
const CREATE = 'tournamentGames:createPoolGames';
const ARGS = { orgSlug: COASTAL.slug, tournamentSlug: 'winter-doubles-classic' };

const BASE_TOURNAMENT = {
  tournamentId: 'tn_winter',
  organizationId: COASTAL.organizationId,
  role: 'orgAdmin',
  status: 'published',
  organization: { name: COASTAL.name, slug: COASTAL.slug },
  name: 'Winter Doubles Classic',
  slug: 'winter-doubles-classic',
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 2v2 · Open',
  locations: [],
  minimumRosterSize: 2,
  maximumTeams: 16,
  sport: 'beachVolleyball',
  teamCount: 12,
  setsPerGame: 1,
  bracketCreated: false,
  poolGamesCreated: false,
  structure: 'pools',
};
const OPEN = {
  ...BASE_TOURNAMENT,
  startDate: '2099-01-16',
  endDate: '2099-01-17',
  registrationDeadline: '2099-01-09',
};
const CLOSED = {
  ...BASE_TOURNAMENT,
  startDate: '2025-01-16',
  endDate: '2025-01-17',
  registrationDeadline: '2025-01-09',
};

const teamName = (seed: number) => `Team ${String(seed).padStart(2, '0')}`;
const team = (seed: number) => ({
  teamId: `tm_${seed}`,
  name: teamName(seed),
  rosterCount: 2,
  seed,
});

const SNAKE = [
  ['A', [1, 6, 7, 12]],
  ['B', [2, 5, 8, 11]],
  ['C', [3, 4, 9, 10]],
] as const;

function poolsOf(
  poolSeeds: readonly (readonly [string, readonly number[]])[],
  more: object = {},
  games: Record<string, readonly (readonly [number, number, number])[]> = {},
) {
  const confirmedCount = poolSeeds.reduce((total, [, seeds]) => total + seeds.length, 0);
  return {
    confirmedCount,
    unconfirmedCount: 0,
    pools: poolSeeds.map(([pool, seeds]) => ({
      pool,
      teams: seeds.map(team),
      games: (games[pool] ?? []).map(([round, one, other], index) => ({
        gameId: `g_${pool}_${index}`,
        round,
        slot: index + 1,
        teams: [one, other].map((seed) => ({ teamId: `tm_${seed}`, name: teamName(seed) })),
        winnerTeamId: null,
        result: null,
      })),
    })),
    seeds: poolSeeds
      .flatMap(([, seeds]) => seeds)
      .sort((a, b) => a - b)
      .map(team),
    unassigned: [],
    gamesCreated: Object.keys(games).length > 0,
    gamesCurrent: Object.keys(games).length > 0,
    hasResult: false,
    ...more,
  };
}

const unsplit = (count: number) => ({
  confirmedCount: count,
  unconfirmedCount: 0,
  pools: [],
  seeds: Array.from({ length: count }, (_, index) => team(index + 1)),
  unassigned: Array.from({ length: count }, (_, index) => team(index + 1)),
  gamesCreated: false,
  gamesCurrent: false,
  hasResult: false,
});

const UNDO = {
  earlier: [{ teamId: 'tm_1', pool: null }],
  written: [{ teamId: 'tm_1', pool: 'A' }],
  gameIds: [],
};

const GAMES = { A: [[1, 1, 12]], B: [[1, 2, 11]], C: [[1, 3, 10]] } as const;

describe('PoolsPanel', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(tournament: object, pools?: unknown) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(tournament);
    await o.flush();
    o.subscription(LIST_WAITLIST)?.emit({ rows: [], waitlistCount: 0 });
    await o.flush();
    if (pools !== undefined) o.subscription(POOLS)?.emit(pools);
    await o.flush();
  }

  const panel = () => page.querySelector<HTMLElement>('#pools')!;
  const poolSection = (pool: string) =>
    panel().querySelector<HTMLElement>(`[data-pool="${pool}"]`)!;
  const teamsIn = (pool: string) =>
    [...poolSection(pool).querySelectorAll<HTMLElement>('li[data-team-id] h4')].map((h4) =>
      text(h4),
    );
  const headings = () => [...panel().querySelectorAll('h3')].map((h3) => text(h3));
  const moveButton = (name: string, pool: string) =>
    [...panel().querySelectorAll<HTMLElement>('li[data-team-id]')]
      .find((row) => text(row.querySelector('h4')) === name)!
      .querySelector<HTMLButtonElement>(`[data-move-to="${pool}"]`)!;
  const status = () => text(panel().querySelector('[data-slot="pool-status"]'));
  const undoButton = () => panel().querySelector<HTMLButtonElement>('[data-slot="undo-split"]');
  const splitButton = () => panel().querySelector<HTMLButtonElement>('#split-pools');
  const createButton = () => panel().querySelector<HTMLButtonElement>('#create-pool-games');
  const count = (n: number) => panel().querySelector<HTMLInputElement>(`#pool-count-${n}`);
  const splitReason = () => text(panel().querySelector('[data-slot="split-reason"]'));
  const gamesReason = () => text(panel().querySelector('[data-slot="games-reason"]'));
  const alerts = () => [...panel().querySelectorAll<HTMLElement>('[data-slot="alert"]')];
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    )!;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function chooseCount(n: number) {
    const radio = count(n)!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function goOffline() {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    TestBed.tick();
    await o.harness.fixture.whenStable();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    window.dispatchEvent(new Event('online'));
  });

  describe('loading and failing', () => {
    it('asks tournamentGames.getPools, and not getSetup, for a Pools tournament', async () => {
      await open(CLOSED);
      expect(o.subscription(POOLS)!.args).toEqual(ARGS);
      expect(o.subscription(SETUP)).toBeUndefined();
      expect(page.querySelector('#bracket')).toBeNull();
    });

    it('asks getSetup, and shows the bracket panel, for a Bracket only tournament', async () => {
      await open({ ...CLOSED, structure: 'bracket' });
      expect(o.subscription(SETUP)!.args).toEqual(ARGS);
      expect(o.subscription(POOLS)).toBeUndefined();
      expect(page.querySelector('#pools')).toBeNull();
      expect(page.querySelector('#bracket')).not.toBeNull();
    });

    it('shows a skeleton and a polite status while the answer is awaited, and the rest of the page', async () => {
      await open(CLOSED);
      expect(text(panel().querySelector('h2'))).toBe('Pools');
      expect(text(panel().querySelector('[role="status"]'))).toBe('Loading the pools.');
      expect(panel().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
      expect(splitButton()).toBeNull();
      expect(page.querySelector('#edit-details')).not.toBeNull();
    });

    it('a failed query shows an alert with a Try again link, and no pools', async () => {
      await open(CLOSED);
      o.subscription(POOLS)!.fail(new Error('Server Error: secret'));
      await o.flush();
      expect(alerts().map((a) => [a.getAttribute('role'), text(a)])).toEqual([
        ['alert', 'The pools could not be loaded. Check your connection and try again. Try again'],
      ]);
      expect(panel().textContent).not.toContain('secret');
      const retry = [...panel().querySelectorAll('a')].find((a) => text(a) === 'Try again')!;
      expect(retry.getAttribute('href')).toBe(URL);
    });
  });

  describe('the limits', () => {
    it('with no confirmed team shows the empty state with the reason', async () => {
      await open(CLOSED, unsplit(0));
      expect(text(panel().querySelector('[data-slot="empty"]'))).toBe(
        'No confirmed teams yet A team is confirmed once 2 players are on its roster. Confirmed teams appear here as seeds. Pools need 6 to 64 confirmed teams.',
      );
      expect(splitButton()).toBeNull();
    });

    it.each([5, 65])('with %s confirmed teams offers no split and says why', async (teams) => {
      await open(CLOSED, unsplit(teams));
      expect(splitReason()).toBe('Pools need 6 to 64 confirmed teams.');
      expect(splitButton()).toBeNull();
      expect(panel().querySelector('app-chip-radio-group')).toBeNull();
      expect(createButton()).toBeNull();
    });

    it('says how many teams are left out for having too few players', async () => {
      await open(CLOSED, { ...unsplit(12), unconfirmedCount: 2 });
      expect(text(panel().querySelector('[data-slot="unconfirmed"]'))).toBe(
        '2 teams have fewer than 2 players, so they are in no pool.',
      );
    });

    it('before the registration deadline gives the reason and no split', async () => {
      await open(OPEN, unsplit(12));
      expect(splitReason()).toBe(
        'Registration is open until Jan 9, 2099. Split the teams into pools after it closes.',
      );
      expect(splitButton()).toBeNull();
      expect(createButton()).toBeNull();
    });
  });

  describe('splitting into pools', () => {
    beforeEach(() => open(CLOSED, unsplit(12)));

    it('offers the numbers of pools that keep every pool within 3 to 8 teams', () => {
      const labels = [...panel().querySelectorAll('app-chip-radio-group label')].map((label) =>
        text(label),
      );
      expect(labels).toEqual(['2 pools', '3 pools', '4 pools']);
      expect(count(2)!.checked).toBe(true);
    });

    it('sends the number chosen and says what was done', async () => {
      await chooseCount(3);
      const button = splitButton()!;
      expect(text(button)).toBe('Split into pools');
      button.click();
      await o.flush();
      expect(calls()).toEqual([[SPLIT, { tournamentId: 'tn_winter', poolCount: 3 }]]);
      expectPendingSpinner(button);
      expect(text(button)).toBe('Splitting…');
      o.convex.calls[0].resolve({ poolCount: 3, teamCount: 12, undo: UNDO });
      o.subscription(POOLS)!.emit(poolsOf(SNAKE));
      await o.flush();
      const [alert] = alerts();
      expect(alert.getAttribute('role')).toBe('status');
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('Teams split into pools');
      expect(text(splitButton())).toBe('Split again');
    });

    describe('Undo', () => {
      beforeEach(async () => {
        splitButton()!.click();
        await o.flush();
        o.convex.calls[0].resolve({ poolCount: 2, teamCount: 12, undo: UNDO });
        o.subscription(POOLS)!.emit(poolsOf(SNAKE));
        await o.flush();
      });

      it('is offered in the status, and sends what the split returned', async () => {
        expect(text(undoButton())).toBe('Undo');
        undoButton()!.click();
        await o.flush();
        expect(calls()[1]).toEqual([UNDO_SPLIT, { tournamentId: 'tn_winter', ...UNDO }]);
        expect(text(undoButton())).toBe('Undoing…');
        expect(undoButton()!.getAttribute('aria-disabled')).toBe('true');
      });

      it('says the earlier pools are back, and the status takes focus because Undo is gone', async () => {
        undoButton()!.click();
        await o.flush();
        o.convex.calls[1].resolve(null);
        await o.flush();
        const [alert] = alerts();
        expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
          'Earlier pools restored',
        );
        expect(undoButton()).toBeNull();
        expect(document.activeElement).toBe(alert);
      });

      it('shows the refusal when the pools changed since, in an alert that takes focus', async () => {
        undoButton()!.click();
        await o.flush();
        o.convex.calls[1].reject(
          new ConvexError({
            code: 'poolsChanged',
            message: 'The pools changed since, so the split cannot be undone.',
          }),
        );
        await o.flush();
        expect(text(alerts()[0])).toBe(
          'The split could not be undone. The pools changed since, so the split cannot be undone.',
        );
        expect(document.activeElement).toBe(alerts()[0]);
      });

      it('while offline answers a press with the offline alert, sending nothing more', async () => {
        await goOffline();
        undoButton()!.click();
        await o.flush();
        expect(calls()).toHaveLength(1);
        expect(text(alerts()[0])).toContain(
          'The pools stay as they are. Try again when you’re connected.',
        );
      });

      it('goes away when the next change starts', async () => {
        moveButton('Team 01', 'B').click();
        await o.flush();
        expect(undoButton()).toBeNull();
      });
    });

    it('shows a refusal in an alert that takes focus, and keeps the choice', async () => {
      await chooseCount(4);
      splitButton()!.click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'poolRegistrationOpen',
          message:
            'Registration is open until Jan 9, 2099. Split the teams into pools after it closes.',
        }),
      );
      await o.flush();
      expect(text(alerts()[0])).toBe(
        'The teams could not be split into pools. Registration is open until Jan 9, 2099. Split the teams into pools after it closes.',
      );
      expect(document.activeElement).toBe(alerts()[0]);
      expect(count(4)!.checked).toBe(true);
    });

    it('while offline marks the button and answers a press with the offline alert', async () => {
      await goOffline();
      expect(splitButton()!.getAttribute('aria-disabled')).toBe('true');
      splitButton()!.click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(text(alerts()[0])).toContain(
        'The pools are unchanged. Try again when you’re connected.',
      );
    });
  });

  describe('the pools', () => {
    it('lists each pool with its teams in seed order, their seeds, and their players', async () => {
      await open(CLOSED, poolsOf(SNAKE));
      expect(headings()).toEqual(['Seeds', 'Pool A', 'Pool B', 'Pool C']);
      expect(teamsIn('A')).toEqual(['Team 01', 'Team 06', 'Team 07', 'Team 12']);
      expect(teamsIn('C')).toEqual(['Team 03', 'Team 04', 'Team 09', 'Team 10']);
      const seeds = [...poolSection('A').querySelectorAll('li > span')].map((span) => text(span));
      expect(seeds).toEqual(['Seed 1', 'Seed 6', 'Seed 7', 'Seed 12']);
      expect(poolSection('A').querySelector('ol')?.tagName).toBe('OL');
      expect(text(poolSection('A').querySelector('[data-slot="players"]'))).toBe('2 players');
    });

    it('keeps the chosen number of pools at the pools already made', async () => {
      await open(CLOSED, poolsOf(SNAKE));
      expect(count(3)!.checked).toBe(true);
    });

    it('says how many confirmed teams are in no pool', async () => {
      await open(CLOSED, poolsOf(SNAKE, { unassigned: [team(13)], confirmedCount: 13 }));
      expect(text(panel().querySelector('[data-slot="unassigned"]'))).toBe(
        '1 confirmed team is in no pool. Split the teams again to place it.',
      );
    });
  });

  describe('moving a team to another pool', () => {
    beforeEach(() => open(CLOSED, poolsOf(SNAKE)));

    it('offers a button for each other pool, named with the team', () => {
      expect(text(moveButton('Team 01', 'B'))).toBe('Move to Pool B Team 01');
      expect(text(moveButton('Team 01', 'C'))).toBe('Move to Pool C Team 01');
      expect(panel().querySelector('li[data-team-id="tm_1"] [data-move-to="A"]')).toBeNull();
    });

    it('moves a team from the keyboard: a status announces the new pool, and focus stays on the team', async () => {
      const button = moveButton('Team 01', 'B');
      button.focus();
      button.click();
      await o.flush();
      expect(calls()).toEqual([[MOVE, { tournamentId: 'tn_winter', teamId: 'tm_1', pool: 'B' }]]);
      expectPendingSpinner(button);
      expect(text(button)).toBe('Moving… Team 01');
      o.convex.calls[0].resolve({ pool: 'B', poolTeamCount: 5 });
      o.subscription(POOLS)!.emit(
        poolsOf([
          ['A', [6, 7, 12]],
          ['B', [1, 2, 5, 8, 11]],
          ['C', [3, 4, 9, 10]],
        ]),
      );
      await o.flush();
      expect(teamsIn('B')).toEqual(['Team 01', 'Team 02', 'Team 05', 'Team 08', 'Team 11']);
      expect(status()).toBe('Team 01 moved to Pool B. Pool B has 5 teams.');
      expect(panel().querySelector('[data-slot="pool-status"]')?.getAttribute('role')).toBe(
        'status',
      );
      expect(document.activeElement).toBe(moveButton('Team 01', 'A'));
    });

    it('holds the other buttons while a move is pending', async () => {
      moveButton('Team 01', 'B').click();
      await o.flush();
      expect(moveButton('Team 02', 'A').getAttribute('aria-disabled')).toBe('true');
      moveButton('Team 02', 'A').click();
      await o.flush();
      expect(calls()).toHaveLength(1);
    });

    it('leaves focus where the user moved it while the move was pending', async () => {
      const button = moveButton('Team 01', 'B');
      button.focus();
      button.click();
      await o.flush();
      moveButton('Team 02', 'C').focus();
      o.convex.calls[0].resolve({ pool: 'B', poolTeamCount: 5 });
      await o.flush();
      expect(document.activeElement).toBe(moveButton('Team 02', 'C'));
    });

    it('shows the 3 to 8 limit when the server refuses the move, in an alert that takes focus', async () => {
      moveButton('Team 01', 'B').click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'poolSize',
          message: 'Pool B would have 9 teams. Each pool needs 3 to 8 teams.',
        }),
      );
      await o.flush();
      const [alert] = alerts();
      expect(alert.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        'Team 01 could not be moved. Pool B would have 9 teams. Each pool needs 3 to 8 teams.',
      );
      expect(document.activeElement).toBe(alert);
      expect(teamsIn('A')).toEqual(['Team 01', 'Team 06', 'Team 07', 'Team 12']);
    });

    it('names a failure it cannot word, without the server detail', async () => {
      moveButton('Team 01', 'B').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(alerts()[0])).toBe(
        'Team 01 could not be moved. Check your connection and try again.',
      );
      expect(panel().textContent).not.toContain('secret');
    });

    it('while offline answers a press with the offline alert, sending nothing', async () => {
      await goOffline();
      expect(moveButton('Team 01', 'B').getAttribute('aria-disabled')).toBe('true');
      moveButton('Team 01', 'B').click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(text(alerts()[0])).toContain(
        'Team 01 keeps its pool. Try again when you’re connected.',
      );
    });

    it('clears the earlier announcement when the next move starts', async () => {
      moveButton('Team 01', 'B').click();
      await o.flush();
      o.convex.calls[0].resolve({ pool: 'B', poolTeamCount: 5 });
      await o.flush();
      expect(status()).toBe('Team 01 moved to Pool B. Pool B has 5 teams.');
      moveButton('Team 02', 'C').click();
      await o.flush();
      expect(status()).toBe('');
    });
  });

  describe('creating the pool games', () => {
    it('before the teams are split gives the reason and no Create action', async () => {
      await open(CLOSED, unsplit(12));
      expect(createButton()).toBeNull();
      expect(gamesReason()).toBe('Split the teams into pools first.');
    });

    it('with a confirmed team in no pool gives the same reason', async () => {
      await open(CLOSED, poolsOf(SNAKE, { unassigned: [team(13)], confirmedCount: 13 }));
      expect(createButton()).toBeNull();
      expect(gamesReason()).toBe('Split the teams into pools first.');
    });

    it('offers Create pool games and presses it into a pending state', async () => {
      await open(CLOSED, poolsOf(SNAKE));
      const button = createButton()!;
      expect(text(button)).toBe('Create pool games');
      button.click();
      await o.flush();
      expect(calls()).toEqual([[CREATE, { tournamentId: 'tn_winter' }]]);
      expectPendingSpinner(button);
      expect(text(button)).toBe('Creating…');
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it('says "Pool games created" in a status, keeps focus on the button, and lists each pool’s games', async () => {
      await open(CLOSED, poolsOf(SNAKE));
      const button = createButton()!;
      button.focus();
      button.click();
      await o.flush();
      o.convex.calls[0].resolve({ gameCount: 18, replaced: false });
      o.subscription(POOLS)!.emit(poolsOf(SNAKE, {}, GAMES));
      await o.flush();
      const [alert] = alerts();
      expect(alert.getAttribute('role')).toBe('status');
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('Pool games created');
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toContain(
        '18 games in 3 pools.',
      );
      expect(document.activeElement).toBe(createButton());
      expect(text(createButton())).toBe('Recreate pool games');
      expect(
        [
          ...poolSection('A').querySelectorAll('[data-slot="pool-game"] [data-slot="game-label"]'),
        ].map((label) => text(label)),
      ).toEqual(['Round 1: Team 01 v Team 12']);
      expect([...poolSection('B').querySelectorAll('h4')].map((h4) => text(h4))).toContain(
        'Games in Pool B',
      );
    });

    it('shows a refusal in an alert that takes focus', async () => {
      await open(CLOSED, poolsOf(SNAKE));
      createButton()!.click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({ code: 'notSplit', message: 'Split the teams into pools first.' }),
      );
      await o.flush();
      expect(text(alerts()[0])).toBe(
        'The pool games could not be created. Split the teams into pools first.',
      );
      expect(document.activeElement).toBe(alerts()[0]);
    });

    it('while offline answers a press with the offline alert', async () => {
      await open(CLOSED, poolsOf(SNAKE));
      await goOffline();
      expect(createButton()!.getAttribute('aria-disabled')).toBe('true');
      createButton()!.click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(text(alerts()[0])).toContain(
        'No pool games were created. Try again when you’re connected.',
      );
    });
  });

  describe('recreating the pool games', () => {
    beforeEach(() => open({ ...CLOSED, poolGamesCreated: true }, poolsOf(SNAKE, {}, GAMES)));

    it('asks for a confirmation first, and sends nothing on Cancel', async () => {
      expect(text(createButton())).toBe('Recreate pool games');
      createButton()!.click();
      await o.flush();
      expect(text(dialog()!.querySelector('h2'))).toBe('Recreate the pool games?');
      expect(calls()).toEqual([]);
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(createButton());
    });

    it('sends the replacement after the confirmation and closes the dialog with the success status', async () => {
      createButton()!.click();
      await o.flush();
      dialogButton('Recreate pool games').click();
      await o.flush();
      expect(calls()).toEqual([[CREATE, { tournamentId: 'tn_winter', replace: true }]]);
      o.convex.calls[0].resolve({ gameCount: 18, replaced: true });
      await o.flush();
      expect(dialog()).toBeNull();
      expect(text(alerts()[0].querySelector('[data-slot="alert-title"]'))).toBe(
        'Pool games recreated',
      );
      expect(document.activeElement).toBe(createButton());
    });

    it('shows a refusal in the dialog and keeps it open', async () => {
      createButton()!.click();
      await o.flush();
      dialogButton('Recreate pool games').click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'poolResultEntered',
          message: 'A pool result is entered, so the pools cannot change.',
        }),
      );
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(
        'The pool games could not be recreated. A pool result is entered, so the pools cannot change.',
      );
    });

    it('says when the pools changed after the games were created', async () => {
      expect(panel().querySelector('[data-slot="stale-note"]')).toBeNull();
      o.subscription(POOLS)!.emit(poolsOf(SNAKE, { gamesCurrent: false }, GAMES));
      await o.flush();
      expect(text(panel().querySelector('[data-slot="stale-note"]'))).toBe(
        'The pools changed after the games were created. Recreate the games to use the pools as they are.',
      );
    });

    it('with a pool result entered gives the reason, and no split, Move, or Recreate', async () => {
      o.subscription(POOLS)!.emit(poolsOf(SNAKE, { hasResult: true }, GAMES));
      await o.flush();
      expect(createButton()).toBeNull();
      expect(splitButton()).toBeNull();
      expect(splitReason()).toBe('A pool result is entered, so the pools cannot change.');
      expect(gamesReason()).toBe('A pool result is entered, so the pools cannot change.');
      expect(panel().querySelectorAll('[data-move-to]')).toHaveLength(0);
    });
  });

  describe('the seeds', () => {
    const seedRows = () => [...panel().querySelectorAll<HTMLElement>('#pool-seed-list > li')];
    const seedNames = () => seedRows().map((row) => text(row.querySelector('h4')));
    const seedMove = (name: string, direction: 'up' | 'down') =>
      seedRows()
        .find((row) => text(row.querySelector('h4')) === name)!
        .querySelector<HTMLButtonElement>(`[data-move="${direction}"]`)!;
    const seedStatus = () => text(panel().querySelector('[data-slot="seed-status"]'));

    it('lists the confirmed teams in seed order before the split, with Move up and Move down', async () => {
      await open(CLOSED, unsplit(6));
      expect(seedNames()).toEqual([1, 2, 3, 4, 5, 6].map(teamName));
      expect(text(seedMove('Team 02', 'up'))).toBe('Move up Team 02');
      expect(seedMove('Team 01', 'up').getAttribute('aria-disabled')).toBe('true');
      expect(seedMove('Team 06', 'down').getAttribute('aria-disabled')).toBe('true');
      expect(text(panel().querySelector('[data-slot="seeds"] p'))).toBe(
        'Seed 1 goes in Pool A first. Move a team up or down to set the order, then split.',
      );
    });

    it('moves a seed from the keyboard: a status announces the place, and focus stays on the button', async () => {
      await open(CLOSED, unsplit(6));
      const button = seedMove('Team 03', 'up');
      button.focus();
      button.click();
      await o.flush();
      expect(calls()).toEqual([
        [MOVE_SEED, { tournamentId: 'tn_winter', teamId: 'tm_3', direction: 'up' }],
      ]);
      expectPendingSpinner(button);
      o.convex.calls[0].resolve({ seed: 2, seedCount: 6 });
      o.subscription(POOLS)!.emit({
        ...unsplit(6),
        seeds: [1, 3, 2, 4, 5, 6].map(team),
      });
      await o.flush();
      expect(seedNames().slice(0, 3)).toEqual(['Team 01', 'Team 03', 'Team 02']);
      expect(seedStatus()).toBe('Team 03 moved up to seed 2 of 6.');
      expect(document.activeElement).toBe(seedMove('Team 03', 'up'));
    });

    it('says the pools keep their seeds once the teams are split', async () => {
      await open(CLOSED, poolsOf(SNAKE));
      expect(text(panel().querySelector('[data-slot="seeds"] p'))).toBe(
        'The pools keep the seeds they were split with. Split again to use this order.',
      );
    });

    it('shows a refusal in an alert that takes focus, and keeps the order', async () => {
      await open(CLOSED, unsplit(6));
      seedMove('Team 02', 'up').click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'seedsLocked',
          message: 'A result is entered, so the seeds cannot change.',
        }),
      );
      await o.flush();
      expect(text(alerts()[0])).toBe(
        'Team 02 could not be moved. A result is entered, so the seeds cannot change.',
      );
      expect(document.activeElement).toBe(alerts()[0]);
    });

    it('while offline answers a press with the offline alert, sending nothing', async () => {
      await open(CLOSED, unsplit(6));
      await goOffline();
      seedMove('Team 02', 'up').click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(text(alerts()[0])).toContain(
        'Team 02 keeps its seed. Try again when you’re connected.',
      );
    });

    it('with a pool result entered lists the seeds without Move buttons', async () => {
      await open(CLOSED, poolsOf(SNAKE, { hasResult: true }, GAMES));
      expect(seedRows()).toHaveLength(12);
      expect(panel().querySelectorAll('[data-move]')).toHaveLength(0);
    });

    it('with one confirmed team lists no seeds', async () => {
      await open(CLOSED, unsplit(1));
      expect(panel().querySelector('[data-slot="seeds"]')).toBeNull();
    });
  });

  describe('moves the limits always refuse', () => {
    it('offers no move out of a pool of 3, nor into a pool of 8', async () => {
      await open(
        CLOSED,
        poolsOf([
          ['A', [1, 4, 5]],
          ['B', [2, 3, 6, 7, 8, 9, 10, 11]],
          ['C', [12, 13, 14, 15]],
        ]),
      );
      const targets = (name: string) =>
        [
          ...[...panel().querySelectorAll('li[data-team-id]')]
            .find((row) => text(row.querySelector('h4')) === name)!
            .querySelectorAll('[data-move-to]'),
        ].map((button) => button.getAttribute('data-move-to'));
      expect(targets('Team 01')).toEqual([]);
      expect(targets('Team 02')).toEqual(['A', 'C']);
      expect(targets('Team 12')).toEqual(['A']);
    });

    it('reads 1 team for a pool of one', async () => {
      await open(CLOSED, poolsOf([['A', [1]]]));
      expect(text(poolSection('A').querySelector('p'))).toBe('1 team');
    });
  });
});
