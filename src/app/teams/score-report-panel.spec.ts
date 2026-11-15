import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../convex/_generated/dataModel';
import type { Sport } from '../../../convex/lib/sports';
import { ConvexOfflineError } from '../core/data/convex';
import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { expectPendingSpinner } from '../ui/testing/spinner';
import { ScoreReportPanel } from './score-report-panel';

const FOR_TEAM = 'scoreReports:forTeam';
const REPORT = 'scoreReports:report';

/** What the team page knows of its tournament before the game answers. */
const TOURNAMENT: { sport: Sport; setsPerGame: number; gameCount: number } = {
  sport: 'beachVolleyball',
  setsPerGame: 1,
  gameCount: 1,
};

@Component({
  imports: [ScoreReportPanel],
  template:
    '<app-score-report-panel [teamId]="teamId" [sport]="tournament.sport" [setsPerGame]="tournament.setsPerGame" [gameCount]="tournament.gameCount" />',
})
class Host {
  protected readonly teamId = 'tm_crabs' as Id<'teams'>;
  protected readonly tournament = TOURNAMENT;
}

const ROUTES = [{ path: 'host', component: Host }];

const ONE_SET = { kind: 'sets', sets: [{ a: 21, b: 18 }] };

const GAME = {
  gameId: 'g_semi',
  stage: 'bracket' as 'bracket' | 'pool',
  roundName: 'Semifinals',
  teams: [
    { teamId: 'tm_crabs', name: 'Sand Crabs' },
    { teamId: 'tm_squad', name: 'Spike Squad' },
  ],
  report: null as null | { score: unknown; reportedAt: number },
};

const answerOf = (games: readonly unknown[], more: object = {}) => ({
  sport: 'beachVolleyball',
  setsPerGame: 1,
  games,
  ...more,
});

const answer = (game: unknown = GAME, more: object = {}) =>
  answerOf(game === null ? [] : [game], more);

const poolGame = (round: number, opponent: string, report: unknown = null) => ({
  ...GAME,
  gameId: `g_pool${round}`,
  stage: 'pool' as const,
  roundName: `Round ${round}`,
  teams: [GAME.teams[0], { teamId: `tm_${opponent}`, name: opponent }],
  report,
});

describe('ScoreReportPanel', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(value?: unknown) {
    o = await openAdmin(ROUTES, '/host');
    page = o.page;
    await o.flush();
    if (value !== undefined) {
      o.subscription(FOR_TEAM)!.emit(value);
      await o.flush();
    }
  }

  const section = () => page.querySelector<HTMLElement>('[data-testid="score-report"]');
  const button = (label: string) =>
    [...page.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b)?.startsWith(label));
  const input = (name: string) =>
    page.querySelector<HTMLInputElement>(`#report-${GAME.gameId}-${name}`)!;
  const form = () => page.querySelector<HTMLFormElement>('form');
  const alertOf = () => page.querySelector<HTMLElement>('[data-slot="alert"]');
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function type(name: string, value: string) {
    const field = input(name);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function press(target: HTMLElement | undefined) {
    target!.click();
    await o.flush();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    window.dispatchEvent(new Event('online'));
  });

  it('asks for the team’s game, and shows a skeleton with a status until it answers', async () => {
    await open();
    expect(o.subscription(FOR_TEAM)?.args).toEqual({ teamId: 'tm_crabs' });
    expect(text(page.querySelector('[role="status"]'))).toBe('Loading the game.');
    expect(page.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(form()).toBeNull();
  });

  describe('the skeleton before the game answers', () => {
    const setRows = () => page.querySelectorAll('[data-slot="skeleton-set"]');

    afterEach(() => {
      Object.assign(TOURNAMENT, { sport: 'beachVolleyball', setsPerGame: 1, gameCount: 1 });
    });

    it.each([1, 3])(
      'draws a row of boxes for each of the %s sets of a beach volleyball game',
      async (sets) => {
        TOURNAMENT.setsPerGame = sets;
        await open();
        expect(setRows()).toHaveLength(sets);
        expect(page.querySelectorAll('[data-slot="skeleton-set-name"]')).toHaveLength(sets);
        expect(page.querySelectorAll('[data-slot="skeleton-note"]')).toHaveLength(
          sets === 3 ? 1 : 0,
        );
      },
    );

    it.each(['soccer', 'softball'] as const)(
      'draws one pair of boxes with no set name for %s',
      async (sport) => {
        TOURNAMENT.sport = sport;
        TOURNAMENT.setsPerGame = 3;
        await open();
        expect(setRows()).toHaveLength(1);
        expect(page.querySelectorAll('[data-slot="skeleton-set-name"]')).toHaveLength(0);
        expect(page.querySelectorAll('[data-slot="skeleton-note"]')).toHaveLength(0);
      },
    );

    it('is also stacked, hidden from everyone, under the empty state, so the empty state is as tall as the form', async () => {
      TOURNAMENT.setsPerGame = 3;
      await open(answer(null, { setsPerGame: 3 }));
      const stacked = page.querySelector('[data-slot="empty"]')!.previousElementSibling!;
      expect(stacked.getAttribute('aria-hidden')).toBe('true');
      expect(stacked.classList.contains('invisible')).toBe(true);
      expect(stacked.querySelectorAll('[data-slot="skeleton-set"]')).toHaveLength(3);
      expect(stacked.querySelector('[role="status"]')).toBeNull();
    });
  });

  it('names the game and opens the form on the first score, with a Report score button', async () => {
    await open(answer());
    expect(text(section()!.querySelector('h2'))).toBe('Report score');
    expect(text(section()!.querySelector('[data-slot="game-label"]'))).toBe(
      'Semifinals: Sand Crabs v Spike Squad',
    );
    expect(form()!.getAttribute('aria-label')).toBe(
      'Report the score of Semifinals: Sand Crabs v Spike Squad',
    );
    expect([...form()!.querySelectorAll('legend')].map((l) => text(l))).toEqual(['Set 1']);
    expect([...form()!.querySelectorAll('label')].map((l) => text(l))).toEqual([
      'Sand Crabs',
      'Spike Squad',
    ]);
    expect(text(button('Report score'))).toBe('Report score');
    expect(button('Cancel')).toBeUndefined();
    expect(form()!.querySelector('input[type="checkbox"], [role="checkbox"]')).toBeNull();
  });

  it('a soccer game takes goals for each team', async () => {
    await open(answer(GAME, { sport: 'soccer' }));
    expect([...form()!.querySelectorAll('label')].map((l) => text(l))).toEqual([
      'Sand Crabs goals',
      'Spike Squad goals',
    ]);
  });

  it('shows the empty state when the team has no game to report', async () => {
    await open(answer(null));
    expect(text(section()!.querySelector('[data-slot="empty"] p'))).toBe(
      'No game to report right now.',
    );
    expect(form()).toBeNull();
  });

  it('shows nothing for a caller the server gives no game to report for', async () => {
    await open(null);
    expect(section()).toBeNull();
    expect(alertOf()).toBeNull();
  });

  it('shows an alert, and no form, when the query fails', async () => {
    await open();
    o.subscription(FOR_TEAM)!.fail(new Error('Server Error: secret'));
    await o.flush();
    expect(text(alertOf())).toBe(
      'The game could not be loaded. Check your connection and reload the page.',
    );
    expect(page.textContent).not.toContain('secret');
    expect(section()).toBeNull();
  });

  describe('checking the score', () => {
    beforeEach(() => open(answer()));

    it('shows a tie under the set once it is left, and sends nothing on a submit with an error', async () => {
      await type('a1', '21');
      await type('b1', '21');
      input('b1').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      await o.harness.fixture.whenStable();
      expect(text(page.querySelector('#report-g_semi-set1-error'))).toBe(
        'Set 1 is tied. A set needs a winner.',
      );
      await press(button('Report score'));
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(input('a1'));
    });

    it('a submit with nothing typed asks for the score and sends nothing', async () => {
      await press(button('Report score'));
      expect(calls()).toEqual([]);
      expect(text(page.querySelector('#report-g_semi-set1-error'))).toBe(
        'Enter the score of set 1.',
      );
    });
  });

  describe('reporting', () => {
    beforeEach(async () => {
      await open(answer());
      await type('a1', '21');
      await type('b1', '18');
    });

    it('sends the game, the team, and the score, and shows Reporting… until the answer', async () => {
      const send = button('Report score')!;
      await press(send);
      expect(calls()).toEqual([[REPORT, { gameId: 'g_semi', teamId: 'tm_crabs', score: ONE_SET }]]);
      expectPendingSpinner(send);
      expect(text(send)).toBe('Reporting…');
      expect(send.getAttribute('aria-disabled')).toBe('true');
      expect(input('a1').value).toBe('21');
    });

    it('says Score reported in a status that takes focus, and shows the report with Change score', async () => {
      await press(button('Report score'));
      o.convex.calls[0].resolve({ reportedAt: 9_000 });
      o.subscription(FOR_TEAM)!.emit(
        answer({ ...GAME, report: { score: ONE_SET, reportedAt: 9_000 } }),
      );
      await o.flush();
      const status = alertOf()!;
      expect(status.getAttribute('role')).toBe('status');
      expect(text(status)).toBe(
        'Score reported The organizer confirms it before the winner advances.',
      );
      expect(document.activeElement).toBe(status);
      expect(form()).toBeNull();
      expect(text(page.querySelector('[data-slot="reported"]'))).toBe(
        'Your report: Sand Crabs 21–18 Spike Squad.',
      );
      expect(button('Change score')).toBeDefined();
    });

    it('a refusal because the game has a result shows in an alert in the server’s words, and keeps the scores', async () => {
      await press(button('Report score'));
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'reportsClosed',
          message: 'This game has a result, so it takes no more score reports.',
        }),
      );
      await o.flush();
      expect(alertOf()!.getAttribute('role')).toBe('alert');
      expect(text(alertOf())).toBe(
        'The score could not be reported. This game has a result, so it takes no more score reports.',
      );
      expect(document.activeElement).toBe(alertOf());
      expect(input('a1').value).toBe('21');
      expect(input('b1').value).toBe('18');
    });

    it('a refusal of the score shows under that set and focuses it', async () => {
      await press(button('Report score'));
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'invalidScore',
          message: 'Set 1 is tied. A set needs a winner.',
          field: 'set1',
        }),
      );
      await o.flush();
      expect(text(page.querySelector('#report-g_semi-set1-error'))).toBe(
        'Set 1 is tied. A set needs a winner.',
      );
      expect(document.activeElement).toBe(input('a1'));
    });

    it('names a failure it cannot word, without the server detail', async () => {
      await press(button('Report score'));
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(alertOf())).toBe(
        'The score could not be reported. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('a call that fails as offline shows the offline alert and keeps the scores', async () => {
      await press(button('Report score'));
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(alertOf())).toContain('Your scores are still here.');
      expect(input('a1').value).toBe('21');
    });
  });

  describe('while offline', () => {
    it('marks Report score, and a press shows the offline alert without sending', async () => {
      await open(answer());
      await type('a1', '21');
      await type('b1', '18');
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      const send = button('Report score')!;
      expect(send.getAttribute('aria-disabled')).toBe('true');
      expect(send.classList.contains('opacity-50')).toBe(true);
      await press(send);
      expect(calls()).toEqual([]);
      expect(text(alertOf())).toContain('Your scores are still here.');
      expect(input('a1').value).toBe('21');
    });
  });

  describe('a team that has reported', () => {
    const REPORTED = answer({ ...GAME, report: { score: ONE_SET, reportedAt: 9_000 } });
    beforeEach(async () => {
      await open(REPORTED);
    });

    it('shows its report and when it counts, with no form until Change score', () => {
      expect(text(page.querySelector('[data-slot="reported"]'))).toBe(
        'Your report: Sand Crabs 21–18 Spike Squad.',
      );
      expect(text(section())).toContain(
        'The organizer confirms it before the winner advances. Report again to change it until then.',
      );
      expect(form()).toBeNull();
    });

    it('Change score opens the form with the reported score and focuses its first box', async () => {
      await press(button('Change score'));
      expect(form()).not.toBeNull();
      expect(input('a1').value).toBe('21');
      expect(input('b1').value).toBe('18');
      expect(document.activeElement).toBe(input('a1'));
      expect(page.querySelector('[data-slot="reported"]')).toBeNull();
    });

    it('Cancel closes the form without sending, and focus returns to Change score', async () => {
      await press(button('Change score'));
      await press(button('Cancel'));
      expect(form()).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(button('Change score'));
    });

    it('a changed score is sent again for the same game and team', async () => {
      await press(button('Change score'));
      await type('b1', '10');
      await press(button('Report score'));
      expect(calls()).toEqual([
        [
          REPORT,
          {
            gameId: 'g_semi',
            teamId: 'tm_crabs',
            score: { kind: 'sets', sets: [{ a: 21, b: 10 }] },
          },
        ],
      ]);
    });
  });

  describe('when the team’s game changes', () => {
    it('starts the next game with empty boxes and no status', async () => {
      await open(answer());
      await type('a1', '21');
      await type('b1', '18');
      await press(button('Report score'));
      o.convex.calls[0].resolve({ reportedAt: 9_000 });
      o.subscription(FOR_TEAM)!.emit(
        answer({ ...GAME, report: { score: ONE_SET, reportedAt: 9_000 } }),
      );
      await o.flush();
      expect(text(alertOf())).toContain('Score reported');

      o.subscription(FOR_TEAM)!.emit(
        answer({
          ...GAME,
          gameId: 'g_final',
          roundName: 'Final',
          teams: [GAME.teams[0], { teamId: 'tm_bombers', name: 'Beach Bombers' }],
        }),
      );
      await o.flush();
      expect(text(section()!.querySelector('[data-slot="game-label"]'))).toBe(
        'Final: Sand Crabs v Beach Bombers',
      );
      expect(alertOf()).toBeNull();
      expect(page.querySelector<HTMLInputElement>('#report-g_final-a1')!.value).toBe('');
      expect(page.querySelector<HTMLInputElement>('#report-g_final-b1')!.value).toBe('');
    });
  });

  describe('pool play', () => {
    const TWO = answerOf([poolGame(2, 'Spike Squad'), poolGame(3, 'Beach Bombers')]);
    const poolInput = (round: number, name: string) =>
      page.querySelector<HTMLInputElement>(`#report-g_pool${round}-${name}`)!;
    const labels = () =>
      [...page.querySelectorAll('[data-slot="game-label"]')].map((label) => text(label));
    const forms = () => [...page.querySelectorAll<HTMLFormElement>('form')];
    const sendFor = (round: number) =>
      forms()
        .find((f) => f.getAttribute('aria-label')?.includes(`Round ${round}`))!
        .querySelector<HTMLButtonElement>('button[type="submit"]')!;

    async function typeInto(round: number, name: string, value: string) {
      const field = poolInput(round, name);
      field.value = value;
      field.dispatchEvent(new Event('input'));
      await o.harness.fixture.whenStable();
    }

    it('lists each game that has no confirmed result, in the order the server sent, each with Report score', async () => {
      await open(TWO);
      expect(labels()).toEqual([
        'Round 2: Sand Crabs v Spike Squad',
        'Round 3: Sand Crabs v Beach Bombers',
      ]);
      expect(forms()).toHaveLength(2);
      expect(forms().map((f) => text(f.querySelector('button[type="submit"]')))).toEqual([
        'Report score',
        'Report score',
      ]);
    });

    it('separates the second game from the first with a line, and not the first from the heading', async () => {
      await open(TWO);
      const hosts = [...page.querySelectorAll('app-score-report-form')];
      expect(hosts.map((host) => host.classList.contains('border-t'))).toEqual([false, true]);
    });

    it('sends the game and team of the form that was pressed, and leaves the other form alone', async () => {
      await open(TWO);
      await typeInto(3, 'a1', '21');
      await typeInto(3, 'b1', '18');
      await press(sendFor(3));
      expect(calls()).toEqual([
        [REPORT, { gameId: 'g_pool3', teamId: 'tm_crabs', score: ONE_SET }],
      ]);
      expect(poolInput(2, 'a1').value).toBe('');
    });

    it('shows Reported and when it counts on a game the team has reported, and the form on the other', async () => {
      await open(
        answerOf([
          poolGame(2, 'Spike Squad', { score: ONE_SET, reportedAt: 9_000 }),
          poolGame(3, 'Beach Bombers'),
        ]),
      );
      const badge = page.querySelector('app-score-report-form [data-slot="badge"]');
      expect(text(badge)).toBe('Reported');
      expect(text(page.querySelector('[data-slot="reported"]'))).toBe(
        'Your report: Sand Crabs 21–18 Spike Squad.',
      );
      expect(text(section())).toContain(
        'The organizer confirms it before it counts in the standings. Report again to change it until then.',
      );
      expect(text(section())).not.toContain('the winner advances');
      expect(forms()).toHaveLength(1);
    });

    it('says in the status that the organizer confirms it before it counts in the standings', async () => {
      await open(TWO);
      await typeInto(2, 'a1', '21');
      await typeInto(2, 'b1', '18');
      await press(sendFor(2));
      o.convex.calls[0].resolve({ reportedAt: 9_000 });
      o.subscription(FOR_TEAM)!.emit(
        answerOf([
          poolGame(2, 'Spike Squad', { score: ONE_SET, reportedAt: 9_000 }),
          poolGame(3, 'Beach Bombers'),
        ]),
      );
      await o.flush();
      expect(text(alertOf())).toBe(
        'Score reported The organizer confirms it before it counts in the standings.',
      );
    });

    it('a soccer pool game takes a tied score, and sends it', async () => {
      await open(answerOf([poolGame(2, 'Spike Squad')], { sport: 'soccer' }));
      await typeInto(2, 'a1', '2');
      await typeInto(2, 'b1', '2');
      await press(sendFor(2));
      expect(calls()).toEqual([
        [REPORT, { gameId: 'g_pool2', teamId: 'tm_crabs', score: { kind: 'goals', a: 2, b: 2 } }],
      ]);
    });

    it('a beach volleyball pool game refuses a tied set, and sends nothing', async () => {
      await open(answerOf([poolGame(2, 'Spike Squad')]));
      await typeInto(2, 'a1', '21');
      await typeInto(2, 'b1', '21');
      await press(sendFor(2));
      expect(calls()).toEqual([]);
    });

    it('a bracket game of a soccer tournament still refuses a tie', async () => {
      await open(answer(GAME, { sport: 'soccer' }));
      await type('a1', '2');
      await type('b1', '2');
      await press(button('Report score'));
      expect(calls()).toEqual([]);
    });

    it('shows the empty state once every pool game has a result', async () => {
      await open(answerOf([]));
      expect(text(section()!.querySelector('[data-slot="empty"] p'))).toBe(
        'No game to report right now.',
      );
    });

    describe('the skeleton before the games answer', () => {
      const blocks = () => page.querySelectorAll('[data-slot="skeleton-block"]');

      it.each([
        [0, 1],
        [1, 1],
        [3, 3],
      ])(
        'holds the space of the %s games the team page counted, at least one form',
        async (count, expected) => {
          TOURNAMENT.gameCount = count;
          await open();
          expect(blocks()).toHaveLength(expected);
          expect([...blocks()].map((block) => block.classList.contains('border-t'))).toEqual(
            Array.from({ length: expected }, (_, index) => index > 0),
          );
          expect(page.querySelectorAll('[role="status"]')).toHaveLength(1);
        },
      );
    });
  });

  describe('a long game label', () => {
    it('keeps two lines at the narrowest widths, in the skeleton and in the form', async () => {
      await open();
      const skeletonLabel = page.querySelector('[data-slot="skeleton-label"]')!;
      expect(skeletonLabel.className).toContain('max-[359px]:min-h-12');
      o.subscription(FOR_TEAM)!.emit(answer());
      await o.flush();
      expect(text(section()!.querySelector('[data-slot="game-label"]'))).toBeTruthy();
      expect(section()!.querySelector('[data-slot="game-label"]')!.className).toContain(
        'max-[359px]:min-h-12',
      );
    });
  });
});
