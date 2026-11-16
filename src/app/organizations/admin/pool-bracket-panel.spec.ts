import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import type { Routes } from '@angular/router';
import { ConvexOfflineError } from '../../core/data/convex';
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
const POOL_BRACKET = 'tournamentGames:getPoolBracket';
const POOLS = 'tournamentGames:getPools';
const SETUP = 'tournamentGames:getSetup';
const CREATE = 'tournamentGames:createBracketFromPools';
const ARGS = { orgSlug: COASTAL.slug, tournamentSlug: 'winter-doubles-classic' };

const TOURNAMENT = {
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
  teamCount: 6,
  setsPerGame: 1,
  bracketCreated: false,
  poolGamesCreated: true,
  structure: 'pools',
  startDate: '2025-01-16',
  endDate: '2025-01-17',
  registrationDeadline: '2025-01-09',
};

const ranked = (
  ...entries: readonly (
    readonly [number, string, number] | readonly [number, string, number, object]
  )[]
) =>
  entries.map(([seed, pool, place, tie]) => ({
    teamId: `tm_${seed}`,
    name: `Team ${String(seed).padStart(2, '0')}`,
    pool,
    place,
    tie: tie ?? null,
  }));
const SIX = ranked([1, 'A', 1], [2, 'B', 1], [3, 'A', 2], [4, 'B', 2], [5, 'A', 3], [6, 'B', 3]);

const setupOf = (more: object = {}) => ({
  poolCount: 2,
  smallestPool: 3,
  gamesCreated: true,
  gamesWithoutResult: 0,
  ranked: SIX,
  bracketSeeds: [],
  bracket: null,
  ...more,
});

const game = (gameId: string, slot: number, one: number | null, other: number | null) => ({
  gameId,
  slot,
  teams: [one, other].map((seed) =>
    seed === null ? null : { teamId: `tm_${seed}`, name: `Team ${String(seed).padStart(2, '0')}` },
  ),
  winnerTeamId: null,
  result: null,
  locked: false,
  reports: [],
});
const RANKING = ['tm_1', 'tm_2', 'tm_3', 'tm_4', 'tm_5', 'tm_6'];
const FOUR = ['tm_1', 'tm_2', 'tm_3', 'tm_4'];
const BRACKET = {
  hasResult: false,
  winner: null,
  rounds: [
    { round: 1, name: 'Semifinals', games: [game('g_1', 1, 1, 4), game('g_2', 2, 2, 3)] },
    { round: 2, name: 'Final', games: [game('g_3', 1, null, null)] },
  ],
};

describe('PoolBracketPanel', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(setup?: unknown, tournament: object = TOURNAMENT) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(tournament);
    await o.flush();
    o.subscription(LIST_WAITLIST)?.emit({ rows: [], waitlistCount: 0 });
    await o.flush();
    if (setup !== undefined) o.subscription(POOL_BRACKET)?.emit(setup);
    await o.flush();
  }

  const panel = () => page.querySelector<HTMLElement>('#pool-bracket')!;
  const rows = () => [...panel().querySelectorAll<HTMLElement>('#pool-bracket-seeds > li')];
  const names = () => rows().map((row) => text(row.querySelector('h3')));
  const moveButton = (name: string, direction: 'up' | 'down') =>
    rows()
      .find((row) => text(row.querySelector('h3')) === name)!
      .querySelector<HTMLButtonElement>(`[data-move="${direction}"]`)!;
  const createButton = () => panel().querySelector<HTMLButtonElement>('#create-pool-bracket');
  const seedStatus = () => text(panel().querySelector('[data-slot="seed-status"]'));
  const reason = () => text(panel().querySelector('[data-slot="create-reason"]'));
  const alerts = () => [...panel().querySelectorAll<HTMLElement>('[data-slot="alert"]')];
  const advanceRadio = (n: number) =>
    panel().querySelector<HTMLInputElement>(`#advance-per-pool-${n}`);
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    )!;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function chooseAdvance(n: number) {
    const radio = advanceRadio(n)!;
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
    it('asks getPoolBracket with the route’s slugs for a Pools tournament, beside the pools', async () => {
      await open();
      expect(o.subscription(POOL_BRACKET)!.args).toEqual(ARGS);
      expect(o.subscription(POOLS)!.args).toEqual(ARGS);
    });

    it('asks nothing of it, and shows no panel, for a Bracket only tournament', async () => {
      await open(undefined, { ...TOURNAMENT, structure: 'bracket' });
      expect(o.subscription(POOL_BRACKET)).toBeUndefined();
      expect(o.subscription(SETUP)).toBeDefined();
      expect(page.querySelector('#pool-bracket')).toBeNull();
    });

    it('shows a skeleton and a polite status while the answer is awaited', async () => {
      await open();
      expect(text(panel().querySelector('h2'))).toBe('Bracket');
      expect(text(panel().querySelector('[role="status"]'))).toBe('Loading the bracket.');
      expect(panel().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
      expect(createButton()).toBeNull();
    });

    it('a failed query shows an alert with a Try again link, and no Create action', async () => {
      await open();
      o.subscription(POOL_BRACKET)!.fail(new Error('Server Error: secret'));
      await o.flush();
      expect(alerts().map((a) => [a.getAttribute('role'), text(a)])).toEqual([
        [
          'alert',
          'The bracket could not be loaded. Check your connection and try again. Try again',
        ],
      ]);
      expect(panel().textContent).not.toContain('secret');
      const retry = [...panel().querySelectorAll('a')].find((a) => text(a) === 'Try again')!;
      expect(retry.getAttribute('href')).toBe(URL);
      expect(createButton()).toBeNull();
    });
  });

  describe('while pool games lack a confirmed result', () => {
    it('says how many, and offers no Create action, no choice, and no seeds', async () => {
      await open(setupOf({ gamesWithoutResult: 3, ranked: [] }));
      expect(reason()).toBe('3 pool games still need a confirmed result.');
      expect(createButton()).toBeNull();
      expect(advanceRadio(1)).toBeNull();
      expect(rows()).toHaveLength(0);
    });

    it('says "1 pool game still needs a confirmed result." for one', async () => {
      await open(setupOf({ gamesWithoutResult: 1, ranked: [] }));
      expect(reason()).toBe('1 pool game still needs a confirmed result.');
    });

    it('says there are no pool games before they are created', async () => {
      await open(setupOf({ gamesCreated: false, ranked: [] }));
      expect(reason()).toBe('This tournament has no pool games.');
      expect(createButton()).toBeNull();
    });
  });

  describe('the seeds', () => {
    it('lists the advancing teams, two from each pool at first, with their pool and place', async () => {
      await open(setupOf());
      expect(names()).toEqual(['Team 01', 'Team 02', 'Team 03', 'Team 04']);
      expect(rows().map((row) => text(row.querySelector('[data-slot="place"]')))).toEqual([
        'Pool A, 1st',
        'Pool B, 1st',
        'Pool A, 2nd',
        'Pool B, 2nd',
      ]);
      expect(rows().map((row) => text(row.querySelector('span')))).toEqual([
        'Seed 1',
        'Seed 2',
        'Seed 3',
        'Seed 4',
      ]);
      expect(panel().querySelector('#pool-bracket-seeds')?.tagName).toBe('OL');
    });

    it('offers 1 team up to the smallest pool, and nothing above it', async () => {
      await open(setupOf({ smallestPool: 3 }));
      expect([1, 2, 3].map((n) => advanceRadio(n) !== null)).toEqual([true, true, true]);
      expect(advanceRadio(4)).toBeNull();
      expect(advanceRadio(2)!.checked).toBe(true);
    });

    it('lists more teams when more advance, and fewer when fewer do', async () => {
      await open(setupOf());
      await chooseAdvance(3);
      expect(names()).toHaveLength(6);
      await chooseAdvance(1);
      expect(names()).toEqual(['Team 01', 'Team 02']);
    });
  });

  describe('moving a seed', () => {
    beforeEach(() => open(setupOf()));

    it('labels each button with the team, and keeps the first Move up and the last Move down in the tab order, marked disabled', () => {
      expect(text(moveButton('Team 02', 'up'))).toBe('Move up Team 02');
      expect(moveButton('Team 01', 'up').getAttribute('aria-disabled')).toBe('true');
      expect(moveButton('Team 01', 'up').hasAttribute('disabled')).toBe(false);
      expect(moveButton('Team 04', 'down').getAttribute('aria-disabled')).toBe('true');
      expect(moveButton('Team 02', 'up').getAttribute('aria-disabled')).toBeNull();
    });

    it('moves a team up from the keyboard: the order changes, a status announces the place, focus stays, and nothing is sent', async () => {
      const button = moveButton('Team 03', 'up');
      button.focus();
      button.click();
      await o.flush();
      expect(names()).toEqual(['Team 01', 'Team 03', 'Team 02', 'Team 04']);
      expect(seedStatus()).toBe('Team 03 moved up to seed 2 of 4.');
      expect(panel().querySelector('[data-slot="seed-status"]')?.getAttribute('role')).toBe(
        'status',
      );
      expect(document.activeElement).toBe(moveButton('Team 03', 'up'));
      expect(calls()).toEqual([]);
    });

    it('moves a team down', async () => {
      moveButton('Team 01', 'down').click();
      await o.flush();
      expect(names()).toEqual(['Team 02', 'Team 01', 'Team 03', 'Team 04']);
      expect(seedStatus()).toBe('Team 01 moved down to seed 2 of 4.');
    });

    it('does nothing when a disabled end button is pressed', async () => {
      moveButton('Team 01', 'up').click();
      moveButton('Team 04', 'down').click();
      await o.flush();
      expect(names()).toEqual(['Team 01', 'Team 02', 'Team 03', 'Team 04']);
      expect(seedStatus()).toBe('');
    });

    it('keeps the order through an answer that repeats the same teams', async () => {
      moveButton('Team 03', 'up').click();
      await o.flush();
      o.subscription(POOL_BRACKET)!.emit(setupOf());
      await o.flush();
      expect(names()).toEqual(['Team 01', 'Team 03', 'Team 02', 'Team 04']);
    });

    it('says so when the pool results change the teams after a move', async () => {
      moveButton('Team 03', 'up').click();
      await o.flush();
      o.subscription(POOL_BRACKET)!.emit(
        setupOf({
          ranked: ranked(
            [2, 'B', 1],
            [1, 'A', 1],
            [3, 'A', 2],
            [4, 'B', 2],
            [5, 'A', 3],
            [6, 'B', 3],
          ),
        }),
      );
      await o.flush();
      expect(seedStatus()).toBe('The pool results changed, so the seeds start again from them.');
    });

    it('starts again from the pool results when they change the teams', async () => {
      moveButton('Team 03', 'up').click();
      await o.flush();
      o.subscription(POOL_BRACKET)!.emit(
        setupOf({
          ranked: ranked(
            [2, 'B', 1],
            [1, 'A', 1],
            [3, 'A', 2],
            [4, 'B', 2],
            [5, 'A', 3],
            [6, 'B', 3],
          ),
        }),
      );
      await o.flush();
      expect(names()).toEqual(['Team 02', 'Team 01', 'Team 03', 'Team 04']);
    });
  });

  describe('registration still open', () => {
    it('gives the reason and no Create action', async () => {
      await open(setupOf(), {
        ...TOURNAMENT,
        startDate: '2099-01-16',
        endDate: '2099-01-17',
        registrationDeadline: '2099-01-09',
      });
      expect(reason()).toBe(
        'Registration is open until Jan 9, 2099. Create the bracket after it closes.',
      );
      expect(createButton()).toBeNull();
    });
  });

  describe('creating the bracket', () => {
    it('offers Create bracket, and sends the advance and the order on a press, with a pending state', async () => {
      await open(setupOf());
      moveButton('Team 03', 'up').click();
      await o.flush();
      const button = createButton()!;
      expect(text(button)).toBe('Create bracket');
      expect(button.getAttribute('data-slot')).toBe('button');
      button.click();
      await o.flush();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            tournamentId: 'tn_winter',
            advancePerPool: 2,
            expectedRanking: RANKING,
            seedOrder: ['tm_1', 'tm_3', 'tm_2', 'tm_4'],
          },
        ],
      ]);
      expectPendingSpinner(button);
      expect(text(button)).toBe('Creating…');
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it('sends the chosen advance', async () => {
      await open(setupOf());
      await chooseAdvance(3);
      createButton()!.click();
      await o.flush();
      expect((o.convex.calls[0].args as { advancePerPool: number }).advancePerPool).toBe(3);
    });

    it('says "Bracket created" in a status, keeps focus on the button, and lists the rounds', async () => {
      await open(setupOf());
      const button = createButton()!;
      button.focus();
      button.click();
      await o.flush();
      o.convex.calls[0].resolve({ gameCount: 3, replaced: false, teamCount: 4 });
      o.subscription(POOL_BRACKET)!.emit(setupOf({ bracket: BRACKET }));
      await o.flush();
      const [alert] = alerts();
      expect(alert.getAttribute('role')).toBe('status');
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('Bracket created');
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toContain(
        '3 games in 2 rounds.',
      );
      expect(document.activeElement).toBe(createButton());
      expect(text(createButton())).toBe('Recreate bracket');
      const rounds = [...panel().querySelectorAll('#pool-bracket-rounds section')];
      expect(rounds.map((round) => text(round.querySelector('h4')))).toEqual([
        'Semifinals',
        'Final',
      ]);
    });

    it('shows a refusal in an alert that takes focus, and keeps the order', async () => {
      await open(setupOf());
      moveButton('Team 03', 'up').click();
      await o.flush();
      createButton()!.click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'poolGamesPending',
          message: '1 pool game still needs a confirmed result.',
        }),
      );
      await o.flush();
      expect(text(alerts()[0])).toBe(
        'The bracket could not be created. 1 pool game still needs a confirmed result.',
      );
      expect(document.activeElement).toBe(alerts()[0]);
      expect(names()).toEqual(['Team 01', 'Team 03', 'Team 02', 'Team 04']);
    });

    it('names a failure it cannot word, without the server detail', async () => {
      await open(setupOf());
      createButton()!.click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(alerts()[0])).toBe(
        'The bracket could not be created. Check your connection and try again.',
      );
      expect(panel().textContent).not.toContain('secret');
    });

    it('while offline marks the button and answers a press with the offline alert', async () => {
      await open(setupOf());
      await goOffline();
      expect(createButton()!.getAttribute('aria-disabled')).toBe('true');
      createButton()!.click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(text(alerts()[0])).toContain(
        'No bracket was created. Try again when you’re connected.',
      );
    });

    it('answers a call that fails as offline with the offline alert', async () => {
      await open(setupOf());
      createButton()!.click();
      await o.flush();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(alerts()[0])).toContain(
        'No bracket was created. Try again when you’re connected.',
      );
    });
  });

  describe('recreating the bracket', () => {
    beforeEach(() => open(setupOf({ bracket: BRACKET, bracketSeeds: FOUR })));

    it('asks for a confirmation first, and sends nothing on Cancel', async () => {
      expect(text(createButton())).toBe('Recreate bracket');
      createButton()!.click();
      await o.flush();
      expect(text(dialog()!.querySelector('h2'))).toBe('Recreate the bracket?');
      expect(calls()).toEqual([]);
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(createButton());
    });

    it('sends the replacement after the confirmation and closes the dialog with the success status', async () => {
      createButton()!.click();
      await o.flush();
      dialogButton('Recreate bracket').click();
      await o.flush();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            tournamentId: 'tn_winter',
            advancePerPool: 2,
            expectedRanking: RANKING,
            seedOrder: ['tm_1', 'tm_2', 'tm_3', 'tm_4'],
            replace: true,
          },
        ],
      ]);
      o.convex.calls[0].resolve({ gameCount: 3, replaced: true, teamCount: 4 });
      await o.flush();
      expect(dialog()).toBeNull();
      expect(text(alerts()[0].querySelector('[data-slot="alert-title"]'))).toBe(
        'Bracket recreated',
      );
    });

    it('shows the bracket’s own advance and seeds, and no note while the list matches it', () => {
      expect(advanceRadio(2)!.checked).toBe(true);
      expect(names()).toEqual(['Team 01', 'Team 02', 'Team 03', 'Team 04']);
      expect(panel().querySelector('[data-slot="seed-note"]')).toBeNull();
    });

    it('tells the organizer a moved seed changes the bracket only when it is recreated', async () => {
      moveButton('Team 03', 'up').click();
      await o.flush();
      expect(text(panel().querySelector('[data-slot="seed-note"]'))).toBe(
        'The bracket keeps the seeds it was created with. Recreate it to use this order.',
      );
    });

    it('starts from a bracket created with 1 from each pool and a reorder, after a reload', async () => {
      o.subscription(POOL_BRACKET)!.emit(
        setupOf({
          bracket: { ...BRACKET, rounds: [BRACKET.rounds[1]] },
          bracketSeeds: ['tm_2', 'tm_1'],
        }),
      );
      await o.flush();
      expect(advanceRadio(1)!.checked).toBe(true);
      expect(names()).toEqual(['Team 02', 'Team 01']);
      expect(panel().querySelector('[data-slot="seed-note"]')).toBeNull();
    });

    it('with a result entered gives the reason, and no Recreate, no choice, and no seeds', async () => {
      o.subscription(POOL_BRACKET)!.emit(setupOf({ bracket: { ...BRACKET, hasResult: true } }));
      await o.flush();
      expect(createButton()).toBeNull();
      expect(reason()).toBe('A result is entered, so the bracket cannot be recreated.');
      expect(advanceRadio(1)).toBeNull();
      expect(rows()).toHaveLength(0);
      expect(panel().querySelectorAll('#pool-bracket-rounds section')).toHaveLength(2);
    });
  });

  describe('teams tied in a pool', () => {
    const tied = (levels: readonly [number, number]) =>
      setupOf({
        ranked: ranked(
          [1, 'A', 1],
          [2, 'B', 1],
          [3, 'A', 2, { place: 2, level: levels[0] }],
          [4, 'B', 2],
          [5, 'A', 3, { place: 2, level: levels[1] }],
          [6, 'B', 3],
        ),
      });
    const tick = async (teamNumber: number) => {
      page.querySelector<HTMLButtonElement>(`#advancing-tm_${teamNumber}`)!.click();
      await o.flush();
    };
    const note = () => text(panel().querySelector('[data-slot="tie-note"]'));

    it('labels the tied teams with the place they share', async () => {
      await open(tied([1, 2]));
      expect(rows().map((row) => text(row.querySelector('[data-slot="place"]')))).toEqual([
        'Pool A, 1st',
        'Pool B, 1st',
        'Pool A, 2nd, tied',
        'Pool B, 2nd',
      ]);
    });

    it.each([
      [[1, 2], 'The team that scored more points in the games between them advances.'],
      [[1, 1], 'so seed order decides.'],
    ] as const)('says what decided it, in one line, for levels %j', async (levels, words) => {
      await open(tied(levels));
      expect(panel().querySelectorAll('[data-slot="tie-note"]')).toHaveLength(1);
      expect(note()).toContain('Pool A is tied for 2nd between Team 03 and Team 05.');
      expect(note()).toContain(words);
    });

    it('names the rule that separated the last team in from the first team out, in a band the points split only partly', async () => {
      await open(
        setupOf({
          ranked: ranked(
            [1, 'A', 1, { place: 1, level: 0 }],
            [2, 'B', 1],
            [3, 'A', 2, { place: 1, level: 1 }],
            [4, 'B', 2],
            [5, 'A', 3, { place: 1, level: 1 }],
            [6, 'B', 3],
          ),
        }),
      );
      await chooseAdvance(1);
      expect(note()).toContain(
        'The team that scored more points in the games between them advances.',
      );
      await chooseAdvance(2);
      expect(note()).toContain('so seed order decides.');
    });

    it('says nothing when the tie is not on the advance line', async () => {
      await open(tied([1, 1]));
      await chooseAdvance(1);
      expect(panel().querySelector('[data-slot="tie-note"]')).toBeNull();
    });

    it('lets the organizer put the other tied team through, says it is their choice, and sends it', async () => {
      await open(tied([1, 2]));
      await tick(3);
      await tick(5);
      expect(names()).toEqual(['Team 01', 'Team 02', 'Team 04', 'Team 05']);
      expect(seedStatus()).toBe('Team 05 advances.');
      expect(note()).toContain('Your choice decides who advances.');
      createButton()!.click();
      await o.flush();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            tournamentId: 'tn_winter',
            advancePerPool: 2,
            expectedRanking: RANKING,
            seedOrder: ['tm_1', 'tm_2', 'tm_4', 'tm_5'],
          },
        ],
      ]);
    });

    it('says under the pool how many to choose, keeps Create, and a press focuses that pool without sending', async () => {
      await open(tied([1, 2]));
      await tick(5);
      const fieldset = panel().querySelector<HTMLElement>('#advancing-pool-A')!;
      expect(text(fieldset.querySelector('[role="alert"]'))).toBe(
        'Choose 2 teams from Pool A. 3 are chosen.',
      );
      expect(fieldset.getAttribute('aria-describedby')).toBe('advancing-error-A');
      expect(panel().querySelector('#advancing-pool-B [role="alert"]')).toBeNull();
      createButton()!.click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(fieldset);
      await tick(5);
      expect(fieldset.querySelector('[role="alert"]')).toBeNull();
    });
  });
});
