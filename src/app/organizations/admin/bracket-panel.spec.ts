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
const SETUP = 'tournamentGames:getSetup';
const MOVE = 'tournamentGames:moveSeed';
const CREATE = 'tournamentGames:createBracket';
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
  teamCount: 3,
  setsPerGame: 1,
  bracketCreated: false,
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

const seed = (name: string, rosterCount = 2) => ({
  teamId: `tm_${name.toLowerCase()}`,
  name,
  rosterCount,
});
const THREE = ['Alpha', 'Bravo', 'Charlie'];
const setupOf = (names: readonly string[], more: object = {}) => ({
  seeds: names.map((name) => seed(name)),
  unconfirmedCount: 0,
  bracket: null,
  ...more,
});
const BRACKET = {
  hasResult: false,
  winner: null,
  rounds: [
    {
      round: 1,
      name: 'Semifinals',
      games: [
        {
          gameId: 'g_1',
          slot: 1,
          teams: [seed('Alpha'), null].map((t) => t && { teamId: t.teamId, name: t.name }),
          winnerTeamId: 'tm_alpha',
          result: null,
          locked: false,
        },
        {
          gameId: 'g_2',
          slot: 2,
          teams: [seed('Bravo'), seed('Charlie')].map((t) => ({ teamId: t.teamId, name: t.name })),
          winnerTeamId: null,
          result: null,
          locked: false,
        },
      ],
    },
    {
      round: 2,
      name: 'Final',
      games: [
        {
          gameId: 'g_3',
          slot: 1,
          teams: [{ teamId: 'tm_alpha', name: 'Alpha' }, null],
          winnerTeamId: null,
          result: null,
          locked: false,
        },
      ],
    },
  ],
};

describe('BracketPanel', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(tournament: object, setup?: unknown) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(tournament);
    await o.flush();
    o.subscription(LIST_WAITLIST)?.emit({ rows: [], waitlistCount: 0 });
    await o.flush();
    if (setup !== undefined) o.subscription(SETUP)?.emit(setup);
    await o.flush();
  }

  const panel = () => page.querySelector<HTMLElement>('#bracket')!;
  const rows = () => [...panel().querySelectorAll<HTMLElement>('#seed-list > li')];
  const names = () => rows().map((row) => text(row.querySelector('h3')));
  const moveButton = (name: string, direction: 'up' | 'down') =>
    rows()
      .find((row) => text(row.querySelector('h3')) === name)!
      .querySelector<HTMLButtonElement>(`[data-move="${direction}"]`)!;
  const createButton = () => panel().querySelector<HTMLButtonElement>('#create-bracket');
  const seedStatus = () => text(panel().querySelector('[data-slot="seed-status"]'));
  const reason = () => text(panel().querySelector('[data-slot="create-reason"]'));
  const alerts = () => [...panel().querySelectorAll<HTMLElement>('[data-slot="alert"]')];
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    )!;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

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
    it('asks tournamentGames.getSetup with the route’s slugs once the tournament has answered', async () => {
      await open(OPEN);
      expect(o.subscription(SETUP)!.args).toEqual(ARGS);
    });

    it('shows a skeleton seed list and a polite status while the answer is awaited, and the rest of the page', async () => {
      await open(OPEN);
      expect(text(panel().querySelector('h2'))).toBe('Seeds and bracket');
      expect(text(panel().querySelector('[role="status"]'))).toBe('Loading the seeds.');
      expect(panel().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
      expect(createButton()).toBeNull();
      expect(page.querySelector('#edit-details')).not.toBeNull();
    });

    it('a failed query shows an alert with a Try again link, and no seeds', async () => {
      await open(OPEN);
      o.subscription(SETUP)!.fail(new Error('Server Error: secret'));
      await o.flush();
      expect(alerts().map((a) => [a.getAttribute('role'), text(a)])).toEqual([
        ['alert', 'The seeds could not be loaded. Check your connection and try again. Try again'],
      ]);
      expect(panel().textContent).not.toContain('secret');
      const retry = [...panel().querySelectorAll('a')].find((a) => text(a) === 'Try again')!;
      expect(retry.getAttribute('href')).toBe(URL);
      expect(createButton()).toBeNull();
    });
  });

  describe('the seeds', () => {
    it('lists the confirmed teams in order with their players, each seed number read as "Seed n"', async () => {
      await open(OPEN, setupOf(THREE));
      expect(names()).toEqual(THREE);
      expect(rows().map((row) => text(row.querySelector('span')))).toEqual([
        'Seed 1',
        'Seed 2',
        'Seed 3',
      ]);
      expect(rows().map((row) => text(row.querySelector('[data-slot="players"]')))).toEqual([
        '2 players',
        '2 players',
        '2 players',
      ]);
      expect(panel().querySelector('#seed-list')?.tagName).toBe('OL');
    });

    it('says how many teams are left out for having too few players', async () => {
      await open(OPEN, setupOf(THREE, { unconfirmedCount: 2 }));
      expect(text(panel().querySelector('[data-slot="unconfirmed"]'))).toBe(
        '2 teams have fewer than 2 players, so they are not seeded.',
      );
    });

    it('with no confirmed team shows the empty state with the reason, and no Create', async () => {
      await open(OPEN, setupOf([]));
      expect(text(panel().querySelector('[data-slot="empty"]'))).toBe(
        'No confirmed teams yet A team is confirmed once 2 players are on its roster. Confirmed teams appear here as seeds. A bracket needs at least 2 confirmed teams.',
      );
      expect(rows()).toHaveLength(0);
      expect(createButton()).toBeNull();
    });

    it('with one confirmed team lists it without Move buttons, and gives the reason instead of Create', async () => {
      await open(CLOSED, setupOf(['Alpha']));
      expect(names()).toEqual(['Alpha']);
      expect(panel().querySelectorAll('[data-move]')).toHaveLength(0);
      expect(createButton()).toBeNull();
      expect(reason()).toBe('A bracket needs at least 2 confirmed teams.');
    });
  });

  describe('moving a seed', () => {
    beforeEach(() => open(OPEN, setupOf(THREE)));

    it('labels each button with the team, and disables the first Move up and the last Move down without removing them from the tab order', () => {
      expect(text(moveButton('Bravo', 'up'))).toBe('Move up Bravo');
      expect(text(moveButton('Bravo', 'down'))).toBe('Move down Bravo');
      expect(moveButton('Alpha', 'up').getAttribute('aria-disabled')).toBe('true');
      expect(moveButton('Alpha', 'up').hasAttribute('disabled')).toBe(false);
      expect(moveButton('Charlie', 'down').getAttribute('aria-disabled')).toBe('true');
      expect(moveButton('Bravo', 'up').getAttribute('aria-disabled')).toBeNull();
    });

    it('does nothing when a disabled end button is pressed', async () => {
      moveButton('Alpha', 'up').click();
      moveButton('Charlie', 'down').click();
      await o.flush();
      expect(calls()).toEqual([]);
    });

    it('moves a team up from the keyboard: the order changes, a status announces the place, and focus stays on the button', async () => {
      const button = moveButton('Charlie', 'up');
      button.focus();
      button.click();
      await o.flush();
      expect(calls()).toEqual([
        [MOVE, { tournamentId: 'tn_winter', teamId: 'tm_charlie', direction: 'up' }],
      ]);
      expectPendingSpinner(button);
      expect(text(button)).toBe('Moving… Charlie');
      o.convex.calls[0].resolve({ seed: 2, seedCount: 3 });
      o.subscription(SETUP)!.emit(setupOf(['Alpha', 'Charlie', 'Bravo']));
      await o.flush();
      expect(names()).toEqual(['Alpha', 'Charlie', 'Bravo']);
      expect(seedStatus()).toBe('Charlie moved up to seed 2 of 3.');
      expect(panel().querySelector('[data-slot="seed-status"]')?.getAttribute('role')).toBe(
        'status',
      );
      expect(document.activeElement).toBe(moveButton('Charlie', 'up'));
    });

    it('moves a team down', async () => {
      moveButton('Alpha', 'down').click();
      await o.flush();
      expect(calls()).toEqual([
        [MOVE, { tournamentId: 'tn_winter', teamId: 'tm_alpha', direction: 'down' }],
      ]);
      o.convex.calls[0].resolve({ seed: 2, seedCount: 3 });
      await o.flush();
      expect(seedStatus()).toBe('Alpha moved down to seed 2 of 3.');
    });

    it('holds the other buttons while a move is pending', async () => {
      moveButton('Bravo', 'up').click();
      await o.flush();
      expect(moveButton('Charlie', 'up').getAttribute('aria-disabled')).toBe('true');
      moveButton('Charlie', 'up').click();
      await o.flush();
      expect(calls()).toHaveLength(1);
    });

    it('leaves focus where the user moved it while the move was pending', async () => {
      const button = moveButton('Charlie', 'up');
      button.focus();
      button.click();
      await o.flush();
      moveButton('Bravo', 'down').focus();
      o.convex.calls[0].resolve({ seed: 2, seedCount: 3 });
      await o.flush();
      expect(document.activeElement).toBe(moveButton('Bravo', 'down'));
    });

    it('shows a refusal under the panel heading in an alert that takes focus, and keeps the order', async () => {
      moveButton('Bravo', 'up').click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'seedsLocked',
          message: 'A result is entered, so the seeds cannot change.',
        }),
      );
      await o.flush();
      const [alert] = alerts();
      expect(alert.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        'Bravo could not be moved. A result is entered, so the seeds cannot change.',
      );
      expect(document.activeElement).toBe(alert);
      expect(names()).toEqual(THREE);
    });

    it('names a failure it cannot word, without the server detail', async () => {
      moveButton('Bravo', 'up').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(alerts()[0])).toBe(
        'Bravo could not be moved. Check your connection and try again.',
      );
      expect(panel().textContent).not.toContain('secret');
    });

    it('while offline marks the buttons and answers a press with the offline alert, sending nothing', async () => {
      await goOffline();
      expect(moveButton('Bravo', 'up').getAttribute('aria-disabled')).toBe('true');
      moveButton('Bravo', 'up').click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(text(alerts()[0])).toContain('Bravo keeps its seed. Try again when you’re connected.');
    });

    it('answers a call that fails as offline with the offline alert', async () => {
      moveButton('Bravo', 'up').click();
      await o.flush();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(alerts()[0])).toContain('Bravo keeps its seed. Try again when you’re connected.');
    });

    it('clears the earlier announcement when the next move starts', async () => {
      moveButton('Bravo', 'up').click();
      await o.flush();
      o.convex.calls[0].resolve({ seed: 1, seedCount: 3 });
      await o.flush();
      expect(seedStatus()).toBe('Bravo moved up to seed 1 of 3.');
      moveButton('Charlie', 'up').click();
      await o.flush();
      expect(seedStatus()).toBe('');
    });
  });

  describe('creating the bracket', () => {
    it('before the registration deadline gives the reason and no Create action', async () => {
      await open(OPEN, setupOf(THREE));
      expect(createButton()).toBeNull();
      expect(reason()).toBe(
        'Registration is open until Jan 9, 2099. Create the bracket after it closes.',
      );
    });

    it('after the deadline offers Create bracket, a primary button, and presses it into a pending state', async () => {
      await open(CLOSED, setupOf(THREE));
      const button = createButton()!;
      expect(text(button)).toBe('Create bracket');
      expect(button.getAttribute('data-slot')).toBe('button');
      button.click();
      await o.flush();
      expect(calls()).toEqual([[CREATE, { tournamentId: 'tn_winter' }]]);
      expectPendingSpinner(button);
      expect(text(button)).toBe('Creating…');
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it('says "Bracket created" in a status once the bracket exists, keeps focus on the button, and lists the rounds', async () => {
      await open(CLOSED, setupOf(THREE));
      const button = createButton()!;
      button.focus();
      button.click();
      await o.flush();
      o.convex.calls[0].resolve({ gameCount: 3, replaced: false });
      o.subscription(SETUP)!.emit(setupOf(THREE, { bracket: BRACKET }));
      await o.flush();
      const [alert] = alerts();
      expect(alert.getAttribute('role')).toBe('status');
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('Bracket created');
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toContain(
        '3 games in 2 rounds.',
      );
      expect(document.activeElement).toBe(createButton());
      expect(text(createButton())).toBe('Recreate bracket');
    });

    it('lists each round by name with its games, a bye as Bye, and a place to fill as To be decided', async () => {
      await open(CLOSED, setupOf(THREE, { bracket: BRACKET }));
      const rounds = [...panel().querySelectorAll('#bracket-rounds section')];
      expect(rounds.map((round) => text(round.querySelector('h4')))).toEqual([
        'Semifinals',
        'Final',
      ]);
      expect(
        rounds.map((round) =>
          [...round.querySelectorAll('[data-slot="game-label"]')].map((game) => text(game)),
        ),
      ).toEqual([
        ['Game 1: Alpha v Bye', 'Game 2: Bravo v Charlie'],
        ['Game 1: Alpha v To be decided'],
      ]);
    });

    it('shows a refusal in an alert that takes focus', async () => {
      await open(CLOSED, setupOf(THREE));
      createButton()!.click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'registrationOpen',
          message: 'Registration is open until Jan 9, 2099. Create the bracket after it closes.',
        }),
      );
      await o.flush();
      expect(text(alerts()[0])).toBe(
        'The bracket could not be created. Registration is open until Jan 9, 2099. Create the bracket after it closes.',
      );
      expect(document.activeElement).toBe(alerts()[0]);
      expect(text(createButton())).toBe('Create bracket');
    });

    it('while offline marks the button and answers a press with the offline alert', async () => {
      await open(CLOSED, setupOf(THREE));
      await goOffline();
      expect(createButton()!.getAttribute('aria-disabled')).toBe('true');
      createButton()!.click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(text(alerts()[0])).toContain(
        'No bracket was created. Try again when you’re connected.',
      );
    });
  });

  describe('recreating the bracket', () => {
    beforeEach(() =>
      open({ ...CLOSED, bracketCreated: true }, setupOf(THREE, { bracket: BRACKET })),
    );

    it('asks for a confirmation first, and sends nothing on Cancel', async () => {
      expect(text(createButton())).toBe('Recreate bracket');
      createButton()!.click();
      await o.flush();
      expect(text(dialog()!.querySelector('h2'))).toBe('Recreate the bracket?');
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
      dialogButton('Recreate bracket').click();
      await o.flush();
      expect(calls()).toEqual([[CREATE, { tournamentId: 'tn_winter', replace: true }]]);
      o.convex.calls[0].resolve({ gameCount: 3, replaced: true });
      await o.flush();
      expect(dialog()).toBeNull();
      expect(text(alerts()[0].querySelector('[data-slot="alert-title"]'))).toBe(
        'Bracket recreated',
      );
      expect(document.activeElement).toBe(createButton());
    });

    it('shows a refusal in the dialog and keeps it open', async () => {
      createButton()!.click();
      await o.flush();
      dialogButton('Recreate bracket').click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'resultEntered',
          message: 'A result is entered, so the bracket cannot be recreated.',
        }),
      );
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(
        'The bracket could not be recreated. A result is entered, so the bracket cannot be recreated.',
      );
    });

    it('with a result entered gives the reason and no Recreate', async () => {
      o.subscription(SETUP)!.emit(setupOf(THREE, { bracket: { ...BRACKET, hasResult: true } }));
      await o.flush();
      expect(createButton()).toBeNull();
      expect(reason()).toBe('A result is entered, so the bracket cannot be recreated.');
      expect(panel().querySelectorAll('[data-move]')).toHaveLength(0);
    });

    it('tells the organizer a moved seed changes the bracket only when it is recreated', () => {
      expect(text(panel().querySelector('[data-slot="seed-note"]'))).toBe(
        'The bracket keeps the seeds it was created with. Recreate it to use this order.',
      );
    });
  });
});
