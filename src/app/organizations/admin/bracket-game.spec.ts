import { ConvexError } from 'convex/values';
import type { Routes } from '@angular/router';
import { TestBed } from '@angular/core/testing';
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
const SETUP = 'tournamentGames:getSetup';
const ENTER = 'tournamentGames:enterResult';
const CORRECT = 'tournamentGames:correctResult';
const UNDO = 'tournamentGames:undoResult';

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
  teamCount: 3,
  setsPerGame: 1,
  bracketCreated: true,
  startDate: '2025-01-16',
  endDate: '2025-01-17',
  registrationDeadline: '2025-01-09',
};

const team = (name: string) => ({ teamId: `tm_${name.toLowerCase()}`, name });
const SEEDS = ['Alpha', 'Bravo', 'Charlie'].map((name) => ({
  ...team(name),
  rosterCount: 2,
}));

interface GameFixture {
  gameId: string;
  slot: number;
  teams: ({ teamId: string; name: string } | null)[];
  winnerTeamId: string | null;
  result: { score: unknown; forfeitTeamId: string | null; resultEnteredAt: number } | null;
  locked: boolean;
}

const game = (
  id: string,
  slot: number,
  names: (string | null)[],
  more: object = {},
): GameFixture => ({
  gameId: id,
  slot,
  teams: names.map((name) => (name === null ? null : team(name))),
  winnerTeamId: null,
  result: null,
  locked: false,
  ...more,
});

const ONE_SET = { kind: 'sets', sets: [{ a: 21, b: 15 }] };

const stored = (score: object = ONE_SET, forfeitTeamId: string | null = null, at = 1_000) => ({
  score,
  forfeitTeamId,
  resultEnteredAt: at,
});

/** Semifinals: Alpha has a bye and Bravo plays Charlie; then the Final. */
function setupOf(
  games: { semi?: GameFixture; bye?: GameFixture; final?: GameFixture } = {},
  winner = null as object | null,
) {
  return {
    seeds: SEEDS,
    unconfirmedCount: 0,
    bracket: {
      hasResult: false,
      winner,
      rounds: [
        {
          round: 1,
          name: 'Semifinals',
          games: [
            games.bye ?? game('g_1', 1, ['Alpha', null], { winnerTeamId: 'tm_alpha' }),
            games.semi ?? game('g_2', 2, ['Bravo', 'Charlie']),
          ],
        },
        {
          round: 2,
          name: 'Final',
          games: [games.final ?? game('g_3', 1, ['Alpha', null])],
        },
      ],
    },
  };
}

describe('BracketGame', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(setup: unknown = setupOf(), tournament: object = TOURNAMENT) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(tournament);
    await o.flush();
    o.subscription('waitlist:listForTournament')?.emit({ rows: [], waitlistCount: 0 });
    await o.flush();
    o.subscription(SETUP)?.emit(setup);
    await o.flush();
  }

  const row = (gameId: string) =>
    page.querySelector<HTMLElement>(`#bracket-rounds [data-game="${gameId}"]`)!;
  const button = (gameId: string, label: string) =>
    [...row(gameId).querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    );
  const input = (gameId: string, name: string) =>
    row(gameId).querySelector<HTMLInputElement>(`#${gameId}-${name}`)!;
  const error = (gameId: string, name: string) =>
    text(row(gameId).querySelector(`#${gameId}-${name}-error`)) ?? null;
  const alertOf = (gameId: string) => row(gameId).querySelector<HTMLElement>('[data-slot="alert"]');
  const statusOf = (gameId: string) =>
    row(gameId).querySelector<HTMLElement>('[data-slot="alert"][role="status"]');
  const titleOf = (gameId: string) =>
    text(alertOf(gameId)?.querySelector('[data-slot="alert-title"]'));
  const form = (gameId: string) => row(gameId).querySelector<HTMLFormElement>('form');
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

  async function fill(gameId: string, a: string, b: string, set = 1) {
    await type(gameId, `a${set}`, a);
    await type(gameId, `b${set}`, b);
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

  describe('a game that can take a result', () => {
    it('offers Enter result only on a game with two teams, not on a bye or a game waiting on a result', async () => {
      await open();
      expect(button('g_2', 'Enter result')).toBeDefined();
      expect(text(button('g_2', 'Enter result'))).toBe('Enter result Bravo v Charlie');
      expect(button('g_1', 'Enter result')).toBeUndefined();
      expect(button('g_3', 'Enter result')).toBeUndefined();
      expect(form('g_2')).toBeNull();
    });

    it('keeps the label of a game as it was', async () => {
      await open();
      expect(
        [...page.querySelectorAll('#bracket-rounds [data-slot="game-label"]')].map((l) => text(l)),
      ).toEqual([
        'Game 1: Alpha v Bye',
        'Game 2: Bravo v Charlie',
        'Game 1: Alpha v To be decided',
      ]);
    });

    it('opens a form with one set for a game of 1 set, and moves focus to its first field', async () => {
      await open();
      await press(button('g_2', 'Enter result'));
      expect(form('g_2')).not.toBeNull();
      expect(document.activeElement).toBe(input('g_2', 'a1'));
      expect([...form('g_2')!.querySelectorAll('legend')].map((l) => text(l))).toEqual(['Set 1']);
      expect([...form('g_2')!.querySelectorAll('label')].map((l) => text(l))).toEqual([
        'Bravo',
        'Charlie',
        'A team forfeits',
      ]);
      expect(button('g_2', 'Enter result')).toBeUndefined();
    });

    it('offers 3 sets in a best of 3, the third only when the teams split the first two', async () => {
      await open(setupOf(), { ...TOURNAMENT, setsPerGame: 3 });
      await press(button('g_2', 'Enter result'));
      expect([...form('g_2')!.querySelectorAll('legend')].map((l) => text(l))).toEqual([
        'Set 1',
        'Set 2',
        'Set 3',
      ]);
      expect(text(form('g_2')!.querySelector('#g_2-set3-note'))).toBe(
        'Only if each team won a set.',
      );
    });

    it.each([
      ['soccer', 'goals'],
      ['softball', 'runs'],
    ])('a %s game takes one score for each team, in %s', async (sport, unit) => {
      await open(setupOf(), { ...TOURNAMENT, sport });
      await press(button('g_2', 'Enter result'));
      expect(form('g_2')!.querySelectorAll('legend')).toHaveLength(0);
      expect([...form('g_2')!.querySelectorAll('label')].map((l) => text(l)).slice(0, 2)).toEqual([
        `Bravo ${unit}`,
        `Charlie ${unit}`,
      ]);
    });

    it('Cancel closes the form without sending, and focus returns to Enter result', async () => {
      await open();
      await press(button('g_2', 'Enter result'));
      await type('g_2', 'a1', '21');
      await press(button('g_2', 'Cancel'));
      expect(form('g_2')).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(button('g_2', 'Enter result'));
    });
  });

  describe('checking the score', () => {
    beforeEach(async () => {
      await open();
      await press(button('g_2', 'Enter result'));
    });

    it('shows nothing on the first keystroke, an error once the pair is left, and clears it while the user types the fix', async () => {
      await type('g_2', 'a1', '21');
      await type('g_2', 'b1', '21');
      expect(error('g_2', 'set1')).toBeNull();
      await leave('g_2', 'b1');
      expect(error('g_2', 'set1')).toBe('Set 1 is tied. A set needs a winner.');
      expect(input('g_2', 'a1').getAttribute('aria-invalid')).toBe('true');
      expect(input('g_2', 'a1').getAttribute('aria-describedby')).toContain('g_2-set1-error');
      await type('g_2', 'b1', '15');
      expect(error('g_2', 'set1')).toBeNull();
    });

    it('does not complain while the user moves from one score to the other', async () => {
      await type('g_2', 'a1', '21');
      input('g_2', 'a1').dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: input('g_2', 'b1') }),
      );
      await o.harness.fixture.whenStable();
      expect(error('g_2', 'set1')).toBeNull();
    });

    it('accepts a set won by one point, as a capped or timed set ends', async () => {
      await fill('g_2', '21', '20');
      await leave('g_2', 'b1');
      expect(error('g_2', 'set1')).toBeNull();
      await press(button('g_2', 'Save result'));
      expect(calls()).toEqual([
        [ENTER, { gameId: 'g_2', score: { kind: 'sets', sets: [{ a: 21, b: 20 }] } }],
      ]);
    });

    it('a submit with an error sends nothing and focuses the first field to fix', async () => {
      await fill('g_2', '21', '21');
      await press(button('g_2', 'Save result'));
      expect(calls()).toEqual([]);
      expect(error('g_2', 'set1')).toBe('Set 1 is tied. A set needs a winner.');
      expect(document.activeElement).toBe(input('g_2', 'a1'));
    });

    it('a submit with nothing typed asks for the score', async () => {
      await press(button('g_2', 'Save result'));
      expect(calls()).toEqual([]);
      expect(error('g_2', 'set1')).toBe('Enter the score of set 1.');
    });
  });

  describe('a tied soccer game', () => {
    it('shows the tie under the pair of scores', async () => {
      await open(setupOf(), { ...TOURNAMENT, sport: 'soccer' });
      await press(button('g_2', 'Enter result'));
      await fill('g_2', '2', '2');
      await leave('g_2', 'b1');
      expect(error('g_2', 'score')).toBe(
        'A bracket game needs a winner, so the scores cannot be tied.',
      );
    });
  });

  describe('saving', () => {
    beforeEach(async () => {
      await open();
      await press(button('g_2', 'Enter result'));
      await fill('g_2', '21', '15');
    });

    it('sends the numbers, shows Saving…, and keeps the form until the answer', async () => {
      const save = button('g_2', 'Save result')!;
      await press(save);
      expect(calls()).toEqual([[ENTER, { gameId: 'g_2', score: ONE_SET }]]);
      expectPendingSpinner(save);
      expect(text(save)).toBe('Saving…');
      expect(save.getAttribute('aria-disabled')).toBe('true');
      expect(input('g_2', 'a1').value).toBe('21');
    });

    it('says Result saved with where the winner goes and an Undo, and takes focus because the Save button is gone', async () => {
      await press(button('g_2', 'Save result'));
      o.convex.calls[0].resolve({
        winnerTeamId: 'tm_bravo',
        winnerName: 'Bravo',
        advancesTo: 'Final',
        previous: null,
        resultEnteredAt: 1_000,
      });
      o.subscription(SETUP)!.emit(
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_bravo',
            result: stored(),
          }),
          final: game('g_3', 1, ['Alpha', 'Bravo']),
        }),
      );
      await o.flush();
      const alert = alertOf('g_2')!;
      expect(alert.getAttribute('role')).toBe('status');
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('Result saved');
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toContain(
        'Bravo advances to the Final.',
      );
      expect(button('g_2', 'Undo')).toBeDefined();
      expect(document.activeElement).toBe(alert);
      expect(form('g_2')).toBeNull();
      expect(text(row('g_2').querySelector('[data-slot="game-result"]'))).toBe(
        'Bravo 21–15 Charlie. Bravo won.',
      );
      expect(text(row('g_3').querySelector('[data-slot="game-label"]'))).toBe(
        'Game 1: Alpha v Bravo',
      );
    });

    it('a server refusal of the score shows under that set, focuses it, and keeps what was typed', async () => {
      await press(button('g_2', 'Save result'));
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'invalidScore',
          message: 'Set 1 is tied. A set needs a winner.',
          field: 'set1',
        }),
      );
      await o.flush();
      expect(error('g_2', 'set1')).toBe('Set 1 is tied. A set needs a winner.');
      expect(document.activeElement).toBe(input('g_2', 'a1'));
      expect(input('g_2', 'a1').value).toBe('21');
      expect(input('g_2', 'b1').value).toBe('15');
      await type('g_2', 'b1', '10');
      expect(error('g_2', 'set1')).toBeNull();
    });

    it('another refusal shows in an alert that takes focus, in words the server gave, and keeps the form', async () => {
      await press(button('g_2', 'Save result'));
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'resultExists',
          message: 'This game has a result already. Correct it instead.',
        }),
      );
      await o.flush();
      const alert = alertOf('g_2')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        'The result could not be saved. This game has a result already. Correct it instead.',
      );
      expect(document.activeElement).toBe(alert);
      expect(input('g_2', 'a1').value).toBe('21');
    });

    it('names a failure it cannot word, without the server detail', async () => {
      await press(button('g_2', 'Save result'));
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(alertOf('g_2'))).toBe(
        'The result could not be saved. Check your connection and try again.',
      );
      expect(row('g_2').textContent).not.toContain('secret');
    });

    it('a call that fails as offline shows the offline alert and keeps the scores', async () => {
      await press(button('g_2', 'Save result'));
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(alertOf('g_2'))).toContain('Your scores are still here.');
      expect(input('g_2', 'a1').value).toBe('21');
    });
  });

  describe('saving the Final', () => {
    it('says the Final’s winner wins the tournament', async () => {
      await open(
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_bravo',
            result: stored(),
          }),
          final: game('g_3', 1, ['Alpha', 'Bravo']),
        }),
      );
      await press(button('g_3', 'Enter result'));
      await fill('g_3', '21', '10');
      await press(button('g_3', 'Save result'));
      o.convex.calls[0].resolve({
        winnerTeamId: 'tm_alpha',
        winnerName: 'Alpha',
        advancesTo: null,
        previous: null,
      });
      await o.flush();
      expect(text(alertOf('g_3')!.querySelector('[data-slot="alert-description"]'))).toContain(
        'Alpha wins the tournament.',
      );
    });
  });

  describe('while offline', () => {
    it('marks Save, and a press shows the offline alert without sending', async () => {
      await open();
      await press(button('g_2', 'Enter result'));
      await fill('g_2', '21', '15');
      await goOffline();
      const save = button('g_2', 'Save result')!;
      expect(save.getAttribute('aria-disabled')).toBe('true');
      await press(save);
      expect(calls()).toEqual([]);
      expect(text(alertOf('g_2'))).toContain('Your scores are still here.');
      expect(input('g_2', 'a1').value).toBe('21');
    });
  });

  describe('a forfeit', () => {
    beforeEach(async () => {
      await open();
      await press(button('g_2', 'Enter result'));
    });

    const forfeitBox = () => row('g_2').querySelector<HTMLElement>('#g_2-forfeit')!;
    const teamChoice = (side: 0 | 1) =>
      row('g_2').querySelector<HTMLInputElement>(`#g_2-forfeit-team-${side}`)!;

    async function tick() {
      forfeitBox().click();
      await o.flush();
    }

    it('replaces the scores with a choice of team, and says the score that will be recorded', async () => {
      await tick();
      expect([...form('g_2')!.querySelectorAll('legend')].map((l) => text(l))).toEqual([
        'Which team forfeits?',
      ]);
      expect(input('g_2', 'a1')).toBeNull();
      expect(text(form('g_2')!.querySelector('#g_2-forfeit-team-description'))).toBe(
        'The other team wins 21–0.',
      );
    });

    it('asks for the team when none is chosen', async () => {
      await tick();
      await press(button('g_2', 'Save result'));
      expect(calls()).toEqual([]);
      expect(text(row('g_2').querySelector('#g_2-forfeit-team-error'))).toBe(
        'Choose the team that forfeits.',
      );
    });

    it('sends the team that forfeits, with no score', async () => {
      await tick();
      teamChoice(1).checked = true;
      teamChoice(1).dispatchEvent(new Event('change', { bubbles: true }));
      await o.flush();
      await press(button('g_2', 'Save result'));
      expect(calls()).toEqual([[ENTER, { gameId: 'g_2', forfeitTeamId: 'tm_charlie' }]]);
    });
  });

  describe('a played game', () => {
    const PLAYED = setupOf({
      semi: game('g_2', 2, ['Bravo', 'Charlie'], {
        winnerTeamId: 'tm_bravo',
        result: stored(),
      }),
      final: game('g_3', 1, ['Alpha', 'Bravo']),
    });

    it('shows the score and the winner with Correct result, and no Enter result', async () => {
      await open(PLAYED);
      expect(text(row('g_2').querySelector('[data-slot="game-result"]'))).toBe(
        'Bravo 21–15 Charlie. Bravo won.',
      );
      expect(button('g_2', 'Correct result')).toBeDefined();
      expect(button('g_2', 'Enter result')).toBeUndefined();
    });

    it('names the team that forfeited', async () => {
      await open(
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_bravo',
            result: stored({ kind: 'sets', sets: [{ a: 21, b: 0 }] }, 'tm_charlie'),
          }),
        }),
      );
      expect(text(row('g_2').querySelector('[data-slot="game-result"]'))).toBe(
        'Bravo 21–0 Charlie. Charlie forfeited. Bravo won.',
      );
    });

    it('with the next game played gives the reason and no Correct', async () => {
      await open(
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_bravo',
            result: stored(),
            locked: true,
          }),
        }),
      );
      expect(button('g_2', 'Correct result')).toBeUndefined();
      expect(text(row('g_2').querySelector('[data-slot="locked"]'))).toBe(
        'The next game has a result, so this result cannot change.',
      );
    });

    it('opens the form with the scores that were saved, and sends a correction', async () => {
      await open(PLAYED);
      await press(button('g_2', 'Correct result'));
      expect(input('g_2', 'a1').value).toBe('21');
      expect(input('g_2', 'b1').value).toBe('15');
      await type('g_2', 'a1', '12');
      await type('g_2', 'b1', '21');
      await press(button('g_2', 'Save correction'));
      expect(calls()).toEqual([
        [CORRECT, { gameId: 'g_2', score: { kind: 'sets', sets: [{ a: 12, b: 21 }] } }],
      ]);
      o.convex.calls[0].resolve({
        winnerTeamId: 'tm_charlie',
        winnerName: 'Charlie',
        advancesTo: 'Final',
        previous: { score: ONE_SET },
      });
      await o.flush();
      expect(text(alertOf('g_2')!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Result corrected',
      );
    });
  });

  describe('Undo', () => {
    const SAVED = {
      winnerTeamId: 'tm_bravo',
      winnerName: 'Bravo',
      advancesTo: 'Final',
      previous: null,
      resultEnteredAt: 1_000,
    };
    const PLAYED = () =>
      setupOf({
        semi: game('g_2', 2, ['Bravo', 'Charlie'], {
          winnerTeamId: 'tm_bravo',
          result: stored(),
        }),
      });

    const CORRECTED = () =>
      setupOf({
        semi: game('g_2', 2, ['Bravo', 'Charlie'], {
          winnerTeamId: 'tm_charlie',
          result: stored({ kind: 'sets', sets: [{ a: 12, b: 21 }] }, null, 2_000),
        }),
      });

    async function saveFirst() {
      await open();
      await press(button('g_2', 'Enter result'));
      await fill('g_2', '21', '15');
      await press(button('g_2', 'Save result'));
      o.convex.calls[0].resolve(SAVED);
      o.subscription(SETUP)!.emit(PLAYED());
      await o.flush();
    }

    it('clears the result, says so, and takes focus because the Undo button is gone', async () => {
      await saveFirst();
      await press(button('g_2', 'Undo'));
      expect(calls().at(-1)).toEqual([UNDO, { gameId: 'g_2', expected: 1_000 }]);
      expectPendingSpinner(button('g_2', 'Undoing'));
      o.convex.calls[1].resolve(null);
      o.subscription(SETUP)!.emit(setupOf());
      await o.flush();
      expect(text(alertOf('g_2')!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Result undone',
      );
      expect(document.activeElement).toBe(alertOf('g_2'));
      expect(button('g_2', 'Undo')).toBeUndefined();
      expect(button('g_2', 'Enter result')).toBeDefined();
    });

    it('after a correction restores the earlier result', async () => {
      await open(PLAYED());
      await press(button('g_2', 'Correct result'));
      await fill('g_2', '12', '21');
      await press(button('g_2', 'Save correction'));
      o.convex.calls[0].resolve({
        ...SAVED,
        winnerName: 'Charlie',
        previous: { score: ONE_SET },
        resultEnteredAt: 2_000,
      });
      o.subscription(SETUP)!.emit(
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_charlie',
            result: stored({ kind: 'sets', sets: [{ a: 12, b: 21 }] }, null, 2_000),
          }),
        }),
      );
      await o.flush();
      await press(button('g_2', 'Undo'));
      expect(calls().at(-1)).toEqual([
        UNDO,
        { gameId: 'g_2', restore: { score: ONE_SET }, expected: 2_000 },
      ]);
      o.convex.calls[1].resolve(null);
      await o.flush();
      expect(text(alertOf('g_2')!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Earlier result restored',
      );
    });

    it('shows a refusal under the status, in words the server gave', async () => {
      await saveFirst();
      await press(button('g_2', 'Undo'));
      o.convex.calls[1].reject(
        new ConvexError({
          code: 'nextGamePlayed',
          message: 'The next game has a result, so this result cannot change.',
        }),
      );
      await o.flush();
      expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toBe(
        'The result could not be undone. The next game has a result, so this result cannot change.',
      );
    });

    it('drops the stale status when the Undo is refused because the next game has a result, and shows the locked line', async () => {
      await saveFirst();
      await press(button('g_2', 'Undo'));
      o.convex.calls[1].reject(
        new ConvexError({
          code: 'nextGamePlayed',
          message: 'The next game has a result, so this result cannot change.',
        }),
      );
      o.subscription(SETUP)!.emit(
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_bravo',
            result: stored(),
            locked: true,
          }),
        }),
      );
      await o.flush();
      expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toBe(
        'The result could not be undone. The next game has a result, so this result cannot change.',
      );
      expect(statusOf('g_2')).toBeNull();
      expect(button('g_2', 'Undo')).toBeUndefined();
      expect(text(row('g_2').querySelector('[data-slot="locked"]'))).toBe(
        'The next game has a result, so this result cannot change.',
      );
      expect(button('g_2', 'Clear result')).toBeUndefined();
    });

    it('shows the refusal of an Undo for a result someone else changed since, drops the stale status, and offers no second Undo', async () => {
      await saveFirst();
      await press(button('g_2', 'Undo'));
      o.convex.calls[1].reject(
        new ConvexError({
          code: 'resultChanged',
          message: 'Someone else changed this result first. The game shows their result now.',
        }),
      );
      o.subscription(SETUP)!.emit(CORRECTED());
      await o.flush();
      const note = row('g_2').querySelector<HTMLElement>('[data-slot="undo-note"]');
      expect(text(note)).toBe(
        'The result could not be undone. Someone else changed this result first. The game shows their result now.',
      );
      expect(document.activeElement).toBe(note!.querySelector('[data-slot="alert"]'));
      expect(text(row('g_2').querySelector('[data-slot="game-result"]'))).toBe(
        'Bravo 12–21 Charlie. Charlie won.',
      );
      expect(statusOf('g_2')).toBeNull();
      expect(button('g_2', 'Undo')).toBeUndefined();
      expect(calls()).toHaveLength(2);
      await press(button('g_2', 'Clear result'));
      expect(calls().at(-1)).toEqual([UNDO, { gameId: 'g_2', expected: 2_000 }]);
    });

    it('keeps the status and its Undo when the Undo fails on the connection, so it can be tried again', async () => {
      await saveFirst();
      await press(button('g_2', 'Undo'));
      o.convex.calls[1].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toBe(
        'The result could not be undone. Check your connection and try again.',
      );
      expect(statusOf('g_2')).not.toBeNull();
      await press(button('g_2', 'Undo'));
      expect(calls()).toHaveLength(3);
    });

    it('is gone with no press once another organizer corrects the result, and the game shows the correction', async () => {
      await saveFirst();
      expect(button('g_2', 'Undo')).toBeDefined();
      o.subscription(SETUP)!.emit(CORRECTED());
      await o.flush();
      expect(button('g_2', 'Undo')).toBeUndefined();
      expect(text(row('g_2').querySelector('[data-slot="game-result"]'))).toBe(
        'Bravo 12–21 Charlie. Charlie won.',
      );
      expect(calls()).toHaveLength(1);
    });

    it('is gone once the next game has a result', async () => {
      await saveFirst();
      o.subscription(SETUP)!.emit(
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_bravo',
            result: stored(),
            locked: true,
          }),
        }),
      );
      await o.flush();
      expect(button('g_2', 'Undo')).toBeUndefined();
    });

    it('while offline marks Undo and answers a press with a note, sending nothing', async () => {
      await saveFirst();
      await goOffline();
      expect(button('g_2', 'Undo')!.getAttribute('aria-disabled')).toBe('true');
      await press(button('g_2', 'Undo'));
      expect(calls()).toHaveLength(1);
      expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toContain(
        'Try again when you’re connected.',
      );
    });
  });

  describe('Clear result', () => {
    const PLAYED = (more: object = {}, final?: GameFixture) =>
      setupOf({
        semi: game('g_2', 2, ['Bravo', 'Charlie'], {
          winnerTeamId: 'tm_bravo',
          result: stored(),
          ...more,
        }),
        final,
      });
    const CLEARED = () => setupOf();
    const RESTORED = (at = 3_000) => PLAYED({ result: stored(ONE_SET, null, at) });
    const FORFEITED = setupOf({
      semi: game('g_2', 2, ['Bravo', 'Charlie'], {
        winnerTeamId: 'tm_bravo',
        result: stored({ kind: 'sets', sets: [{ a: 21, b: 0 }] }, 'tm_charlie'),
      }),
    });
    const refusal = (code: string, message: string) => new ConvexError({ code, message });
    const finalOf = (names: (string | null)[]) => game('g_3', 1, names);

    async function clear(setup: unknown = PLAYED()) {
      await open(setup);
      await press(button('g_2', 'Clear result'));
    }

    it('after a load shows Clear result next to Correct result on a played game, named for the game', async () => {
      await open(PLAYED());
      expect(text(button('g_2', 'Clear result'))).toBe('Clear result Bravo v Charlie');
      expect(button('g_2', 'Correct result')).toBeDefined();
      expect(button('g_2', 'Clear result')!.querySelector('ng-icon')).not.toBeNull();
      expect(text(row('g_2').querySelector('[data-slot="game-result"]'))).toBe(
        'Bravo 21–15 Charlie. Bravo won.',
      );
      expect(statusOf('g_2')).toBeNull();
    });

    it('is not offered on a locked game, which gives the reason', async () => {
      await open(PLAYED({ locked: true }));
      expect(button('g_2', 'Clear result')).toBeUndefined();
      expect(button('g_2', 'Correct result')).toBeUndefined();
      expect(text(row('g_2').querySelector('[data-slot="locked"]'))).toBe(
        'The next game has a result, so this result cannot change.',
      );
    });

    it('is not offered on a bye, a game waiting on a result, or a game with no result', async () => {
      await open();
      for (const id of ['g_1', 'g_2', 'g_3']) {
        expect(button(id, 'Clear result')).toBeUndefined();
        expect(button(id, 'Correct result')).toBeUndefined();
      }
    });

    it('sends the time the result was entered and no restore, and shows Clearing… until the answer', async () => {
      await clear();
      expect(calls()).toEqual([[UNDO, { gameId: 'g_2', expected: 1_000 }]]);
      expect(Object.keys(o.convex.calls[0].args as object)).not.toContain('restore');
      const pending = button('g_2', 'Clearing');
      expectPendingSpinner(pending);
      expect(text(pending)).toBe('Clearing…');
      expect(pending!.getAttribute('aria-disabled')).toBe('true');
      await press(pending);
      expect(calls()).toHaveLength(1);
    });

    it('says Result cleared with an Undo and takes focus, and the game waits for a result again', async () => {
      await clear(PLAYED({}, finalOf(['Alpha', 'Bravo'])));
      o.convex.calls[0].resolve(null);
      o.subscription(SETUP)!.emit(setupOf({ final: finalOf(['Alpha', null]) }));
      await o.flush();
      expect(titleOf('g_2')).toBe('Result cleared');
      expect(text(alertOf('g_2')!.querySelector('[data-slot="alert-description"]'))).toContain(
        'The game is waiting for a result again.',
      );
      expect(alertOf('g_2')!.getAttribute('role')).toBe('status');
      expect(document.activeElement).toBe(alertOf('g_2'));
      expect(button('g_2', 'Undo')).toBeDefined();
      expect(button('g_2', 'Enter result')).toBeDefined();
      expect(button('g_2', 'Clear result')).toBeUndefined();
      expect(text(row('g_3').querySelector('[data-slot="game-label"]'))).toBe(
        'Game 1: Alpha v To be decided',
      );
    });

    it('Undo after a clear enters the cleared score again, says where the winner goes, and takes focus', async () => {
      await clear(PLAYED({}, finalOf(['Alpha', 'Bravo'])));
      o.convex.calls[0].resolve(null);
      o.subscription(SETUP)!.emit(CLEARED());
      await o.flush();
      await press(button('g_2', 'Undo'));
      expect(calls().at(-1)).toEqual([ENTER, { gameId: 'g_2', score: ONE_SET }]);
      const pending = button('g_2', 'Undoing');
      expectPendingSpinner(pending);
      expect(pending!.getAttribute('aria-disabled')).toBe('true');
      o.convex.calls[1].resolve({
        winnerTeamId: 'tm_bravo',
        winnerName: 'Bravo',
        advancesTo: 'Final',
        previous: null,
        resultEnteredAt: 3_000,
      });
      o.subscription(SETUP)!.emit(
        PLAYED({ result: stored(ONE_SET, null, 3_000) }, finalOf(['Alpha', 'Bravo'])),
      );
      await o.flush();
      expect(titleOf('g_2')).toBe('Result restored');
      expect(text(alertOf('g_2')!.querySelector('[data-slot="alert-description"]'))).toContain(
        'Bravo advances to the Final.',
      );
      expect(document.activeElement).toBe(alertOf('g_2'));
      expect(button('g_2', 'Undo')).toBeUndefined();
      expect(button('g_2', 'Clear result')).toBeDefined();
      expect(text(row('g_2').querySelector('[data-slot="game-result"]'))).toBe(
        'Bravo 21–15 Charlie. Bravo won.',
      );
      expect(text(row('g_3').querySelector('[data-slot="game-label"]'))).toBe(
        'Game 1: Alpha v Bravo',
      );
    });

    it('Undo after clearing a forfeit sends the team that forfeited and no score', async () => {
      await clear(FORFEITED);
      o.convex.calls[0].resolve(null);
      o.subscription(SETUP)!.emit(CLEARED());
      await o.flush();
      await press(button('g_2', 'Undo'));
      expect(calls().at(-1)).toEqual([ENTER, { gameId: 'g_2', forfeitTeamId: 'tm_charlie' }]);
      o.convex.calls[1].resolve({
        winnerTeamId: 'tm_bravo',
        winnerName: 'Bravo',
        advancesTo: 'Final',
        previous: null,
        resultEnteredAt: 3_000,
      });
      o.subscription(SETUP)!.emit(
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_bravo',
            result: stored({ kind: 'sets', sets: [{ a: 21, b: 0 }] }, 'tm_charlie', 3_000),
          }),
        }),
      );
      await o.flush();
      expect(text(row('g_2').querySelector('[data-slot="game-result"]'))).toBe(
        'Bravo 21–0 Charlie. Charlie forfeited. Bravo won.',
      );
    });

    it('Undo after clearing the Final says its winner wins the tournament', async () => {
      const final = (result: object | null) =>
        setupOf({
          semi: game('g_2', 2, ['Bravo', 'Charlie'], {
            winnerTeamId: 'tm_bravo',
            result: stored(),
            locked: true,
          }),
          final: game(
            'g_3',
            1,
            ['Alpha', 'Bravo'],
            result ? { winnerTeamId: 'tm_alpha', result } : {},
          ),
        });
      await open(final(stored({ kind: 'sets', sets: [{ a: 21, b: 10 }] }, null, 1_500)));
      await press(button('g_3', 'Clear result'));
      o.convex.calls[0].resolve(null);
      o.subscription(SETUP)!.emit(final(null));
      await o.flush();
      await press(button('g_3', 'Undo'));
      o.convex.calls[1].resolve({
        winnerTeamId: 'tm_alpha',
        winnerName: 'Alpha',
        advancesTo: null,
        previous: null,
        resultEnteredAt: 3_000,
      });
      await o.flush();
      expect(text(alertOf('g_3')!.querySelector('[data-slot="alert-description"]'))).toContain(
        'Alpha wins the tournament.',
      );
    });

    it('shows no Undo on Result cleared once another organizer enters a result', async () => {
      await clear();
      o.convex.calls[0].resolve(null);
      o.subscription(SETUP)!.emit(CLEARED());
      await o.flush();
      expect(button('g_2', 'Undo')).toBeDefined();
      o.subscription(SETUP)!.emit(RESTORED(4_000));
      await o.flush();
      expect(button('g_2', 'Undo')).toBeUndefined();
      expect(button('g_2', 'Clear result')).toBeDefined();
    });

    it('while offline marks Clear result, and a press sends nothing and shows the offline alert, which takes focus', async () => {
      await open(PLAYED());
      await goOffline();
      const clearButton = button('g_2', 'Clear result')!;
      expect(clearButton.getAttribute('aria-disabled')).toBe('true');
      expect(clearButton.classList).toContain('opacity-50');
      await press(clearButton);
      expect(calls()).toEqual([]);
      const note = row('g_2').querySelector<HTMLElement>('[data-slot="undo-note"]');
      expect(text(note)).toContain('The result is unchanged. Try again when you’re connected.');
      expect(document.activeElement).toBe(note!.querySelector('[data-slot="alert"]'));
    });

    it('a Clear that fails as offline shows the same alert and keeps the result', async () => {
      await clear();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toContain(
        'The result is unchanged.',
      );
      expect(button('g_2', 'Clear result')).toBeDefined();
    });

    it('refused because someone else changed the result shows the reason, keeps focus on it, and acts on the current result', async () => {
      await clear();
      o.convex.calls[0].reject(
        refusal(
          'resultChanged',
          'Someone else changed this result first. The game shows their result now.',
        ),
      );
      o.subscription(SETUP)!.emit(RESTORED(2_000));
      await o.flush();
      const note = row('g_2').querySelector<HTMLElement>('[data-slot="undo-note"]');
      expect(text(note)).toBe(
        'The result could not be cleared. Someone else changed this result first. The game shows their result now.',
      );
      expect(document.activeElement).toBe(note!.querySelector('[data-slot="alert"]'));
      expect(button('g_2', 'Correct result')).toBeDefined();
      await press(button('g_2', 'Clear result'));
      expect(calls().at(-1)).toEqual([UNDO, { gameId: 'g_2', expected: 2_000 }]);
    });

    it('refused because the next game has a result shows the reason and the locked line', async () => {
      await clear();
      o.convex.calls[0].reject(
        refusal('nextGamePlayed', 'The next game has a result, so this result cannot change.'),
      );
      o.subscription(SETUP)!.emit(PLAYED({ locked: true }));
      await o.flush();
      expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toBe(
        'The result could not be cleared. The next game has a result, so this result cannot change.',
      );
      expect(text(row('g_2').querySelector('[data-slot="locked"]'))).toBe(
        'The next game has a result, so this result cannot change.',
      );
      expect(button('g_2', 'Clear result')).toBeUndefined();
    });

    it('names a failure it cannot word, without the server detail, and leaves Clear to try again', async () => {
      await clear();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toBe(
        'The result could not be cleared. Check your connection and try again.',
      );
      expect(row('g_2').textContent).not.toContain('secret');
      await press(button('g_2', 'Clear result'));
      expect(calls()).toHaveLength(2);
    });

    describe('Undo on Result cleared', () => {
      async function cleared() {
        await clear();
        o.convex.calls[0].resolve(null);
        o.subscription(SETUP)!.emit(CLEARED());
        await o.flush();
      }

      it('refused because the game has a result already drops the status and shows the reason', async () => {
        await cleared();
        await press(button('g_2', 'Undo'));
        o.convex.calls[1].reject(
          refusal('resultExists', 'This game has a result already. Correct it instead.'),
        );
        o.subscription(SETUP)!.emit(RESTORED(4_000));
        await o.flush();
        const note = row('g_2').querySelector<HTMLElement>('[data-slot="undo-note"]');
        expect(text(note)).toBe(
          'The result could not be restored. This game has a result already. Correct it instead.',
        );
        expect(document.activeElement).toBe(note!.querySelector('[data-slot="alert"]'));
        expect(statusOf('g_2')).toBeNull();
        expect(button('g_2', 'Undo')).toBeUndefined();
      });

      it('is gone with no press once a team in the game changes, so the old result is not written between teams that never played', async () => {
        await cleared();
        expect(button('g_2', 'Undo')).toBeDefined();
        o.subscription(SETUP)!.emit(setupOf({ semi: game('g_2', 2, ['Bravo', 'Delta']) }));
        await o.flush();
        expect(button('g_2', 'Undo')).toBeUndefined();
        expect(button('g_2', 'Enter result')).toBeDefined();
        expect(calls()).toHaveLength(1);
      });

      it('that fails on the connection keeps the status and its Undo', async () => {
        await cleared();
        await press(button('g_2', 'Undo'));
        o.convex.calls[1].reject(new Error('Server Error: secret'));
        await o.flush();
        expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toBe(
          'The result could not be restored. Check your connection and try again.',
        );
        expect(titleOf('g_2')).toBe('Result cleared');
        expect(button('g_2', 'Undo')).toBeDefined();
      });

      it('while offline answers a press with a note, sending nothing', async () => {
        await cleared();
        await goOffline();
        expect(button('g_2', 'Undo')!.getAttribute('aria-disabled')).toBe('true');
        await press(button('g_2', 'Undo'));
        expect(calls()).toHaveLength(1);
        expect(text(row('g_2').querySelector('[data-slot="undo-note"]'))).toContain(
          'The game still has no result. Try again when you’re connected.',
        );
      });
    });
  });

  describe('the winner of the tournament', () => {
    it('is named above the rounds once the Final has a winner', async () => {
      await open(setupOf({}, team('Alpha')));
      expect(text(page.querySelector('#bracket-rounds [data-slot="winner"]'))).toBe(
        'Winner: Alpha',
      );
    });

    it('is not shown before then', async () => {
      await open();
      expect(page.querySelector('[data-slot="winner"]')).toBeNull();
    });
  });
});
