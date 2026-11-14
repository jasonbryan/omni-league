import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../convex/_generated/dataModel';
import { ConvexOfflineError } from '../core/data/convex';
import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { expectPendingSpinner } from '../ui/testing/spinner';
import { ScoreReportPanel } from './score-report-panel';

const FOR_TEAM = 'scoreReports:forTeam';
const REPORT = 'scoreReports:report';

@Component({
  imports: [ScoreReportPanel],
  template: '<app-score-report-panel [teamId]="teamId" />',
})
class Host {
  protected readonly teamId = 'tm_crabs' as Id<'teams'>;
}

const ROUTES = [{ path: 'host', component: Host }];

const ONE_SET = { kind: 'sets', sets: [{ a: 21, b: 18 }] };

const GAME = {
  gameId: 'g_semi',
  roundName: 'Semifinals',
  teams: [
    { teamId: 'tm_crabs', name: 'Sand Crabs' },
    { teamId: 'tm_squad', name: 'Spike Squad' },
  ],
  report: null as null | { score: unknown; reportedAt: number },
};

const answer = (game: unknown = GAME, more: object = {}) => ({
  sport: 'beachVolleyball',
  setsPerGame: 1,
  game,
  ...more,
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
});
