import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { Title } from '@angular/platform-browser';
import type { Routes } from '@angular/router';
import { ConvexOfflineError } from '../../core/data/convex';
import { Elsewhere, forbiddenError, openAdmin, text } from '../admin/testing/admin-harness';
import {
  COED,
  COED_AS_ORGANIZER,
  GET_ORGANIZER_CONTEXT,
  GULF,
} from '../league/testing/league-harness';
import { OUTLINE_BUTTON } from '../admin/button-classes';
import { SeasonPage } from './season-page';
import { fieldShape, formShapes, inputShape, shapeOf } from '../../ui/testing/form-shapes';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { expectBadge } from '../../ui/testing/badge';
import { expectBareCards } from '../../ui/testing/card';
import { slotsOf } from '../../ui/testing/helm-slots';

const GET_VIEW = 'seasons:getOrganizerView';
const LIST_FREE_AGENTS = 'freeAgents:listForOrganizer';
const LIST_WAITLIST = 'waitlist:listForOrganizer';
const SEASON_SLUG = 'summer-2027';
const URL = `/app/organizations/${GULF.slug}/leagues/${COED.slug}/seasons/${SEASON_SLUG}`;
const SLUGS = { orgSlug: GULF.slug, leagueSlug: COED.slug, seasonSlug: SEASON_SLUG };

const ROUTES: Routes = [
  {
    path: 'app/organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    component: SeasonPage,
  },
  { path: 'app/organizations/:orgSlug/leagues/:leagueSlug', component: Elsewhere },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app/teams/:teamId', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];

const team = (teamId: string, name: string, rosterCount: number, pendingInviteCount = 0) => ({
  teamId,
  name,
  captainName: `Captain of ${name}`,
  rosterCount,
  pendingInviteCount,
});

const VIEW = {
  seasonId: 'se_summer27',
  name: 'Summer 2027',
  slug: SEASON_SLUG,
  status: 'published',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
  formatName: '7v7',
  minimumRosterSize: 4,
  teams: [
    team('tm_block', 'Block Party', 6),
    team('tm_dig', 'Dig Deep', 2, 1),
    team('tm_sharks', 'Sand Sharks', 4, 2),
  ],
  teamCount: 3,
};

const freeAgent = (i: number) => ({
  freeAgentId: `fa_${i}`,
  name: `Player ${i}`,
  email: `player${i}@example.com`,
  registeredAt: Date.UTC(2026, 8, 28 + i, 18),
});

const FREE_AGENTS = { rows: [freeAgent(0), freeAgent(1)], hasMore: false };
const NO_WAITLIST = { rows: [], waitlistCount: 0 };

const waiting = (i: number, teamName: string) => ({
  waitlistEntryId: `wl_${i}`,
  teamName,
  captainName: `Captain ${i}`,
  captainEmail: `captain${i}@example.com`,
  requestedAt: Date.UTC(2026, 9, 6 + i, 18),
});

const WAITLIST = {
  rows: [waiting(0, 'Late Lobsters'), waiting(1, 'Shore Thing')],
  waitlistCount: 2,
};
const tokens = (value: string) => value.split(' ').sort();

describe('SeasonPage', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(
    league: unknown,
    view: unknown,
    freeAgents?: unknown,
    waitlist: unknown = NO_WAITLIST,
  ) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(league);
    o.subscription(GET_VIEW)!.emit(view);
    await o.flush();
    o.subscription(LIST_WAITLIST)?.emit(waitlist);
    if (freeAgents !== undefined) o.subscription(LIST_FREE_AGENTS)!.emit(freeAgents);
    await o.flush();
  }

  const teamRows = () => [...page.querySelectorAll<HTMLElement>('#teams-list > li')];
  const freeAgentRows = () => [...page.querySelectorAll<HTMLElement>('#free-agents-list > li')];
  const asked = (name: string) => o.convex.subscriptions.filter((s) => s.name === name);

  describe('loading', () => {
    it('asks nothing until Convex has accepted the token, and shows the polite status', async () => {
      o = await openAdmin(ROUTES, URL);
      TestBed.tick();
      expect(o.convex.subscriptions).toEqual([]);
      expect(text(o.page.querySelector('main [role="status"]'))).toBe('Loading the season.');
    });

    it('draws the tile and panel placeholders as bare helm cards, the size and position of the cards they stand for', async () => {
      o = await openAdmin(ROUTES, URL);
      TestBed.tick();
      expectBareCards(o.page.querySelector('app-season-loading')!, [
        'px-3 py-3 md:px-4 md:py-4',
        'px-3 py-3 md:px-4 md:py-4',
        'overflow-hidden lg:col-span-2',
        'overflow-hidden',
      ]);
    });

    it('asks the league and the season with the slugs, and the free agents only once both answer', async () => {
      o = await openAdmin(ROUTES, URL);
      o.acceptToken();
      expect(asked(GET_ORGANIZER_CONTEXT).map((s) => s.args)).toEqual([
        { orgSlug: GULF.slug, leagueSlug: COED.slug },
      ]);
      expect(asked(GET_VIEW).map((s) => s.args)).toEqual([SLUGS]);
      expect(asked(LIST_FREE_AGENTS)).toEqual([]);
      expect(asked(LIST_WAITLIST)).toEqual([]);
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit(COED);
      o.subscription(GET_VIEW)!.emit(VIEW);
      await o.flush();
      expect(asked(LIST_FREE_AGENTS).map((s) => s.args)).toEqual([SLUGS]);
      expect(asked(LIST_WAITLIST).map((s) => s.args)).toEqual([SLUGS]);
      expect(text(o.page.querySelector('main [role="status"]'))).toBe('Loading the season.');
    });
  });

  describe('an org admin with teams and free agents', () => {
    beforeEach(async () => {
      await open(COED, VIEW, FREE_AGENTS);
    });

    it('draws the limits, tiles, and panels as bare helm cards', () => {
      expectBareCards(page.querySelector('main')!, [
        'mt-6 overflow-hidden',
        'px-3 py-3 md:px-4 md:py-4',
        'px-3 py-3 md:px-4 md:py-4',
        'px-3 py-3 md:px-4 md:py-4',
        'overflow-hidden lg:col-span-2',
        'overflow-hidden',
        'overflow-hidden lg:col-start-3 lg:row-span-2 lg:row-start-1',
      ]);
    });

    it('shows the season header, a breadcrumb to the league, and the title', () => {
      expect(text(page.querySelector('h1'))).toBe('Summer 2027');
      const crumbs = [...page.querySelectorAll('nav[aria-label="Breadcrumb"] a')];
      expect(
        crumbs.map((a) => [text(a), a.getAttribute('href'), a.getAttribute('aria-current')]),
      ).toEqual([
        ['Coed 7v7 Rec', `/app/organizations/${GULF.slug}/leagues/${COED.slug}`, null],
        ['Summer 2027', URL, 'page'],
      ]);
      expect(slotsOf(page.querySelector('nav[aria-label="Breadcrumb"]'))).toEqual([
        'breadcrumb',
        'breadcrumb-list',
        'breadcrumb-item',
        'breadcrumb-link',
        'breadcrumb-separator',
        'breadcrumb-item',
        'breadcrumb-page',
      ]);
      const [leagueCrumb, seasonCrumb] = crumbs;
      expect(leagueCrumb?.classList.contains('underline')).toBe(true);
      expect(seasonCrumb?.classList.contains('underline')).toBe(false);
      expect(text(page.querySelector('main'))).toContain('Published');
      expect(text(page.querySelector('main'))).toContain('Soccer');
      expect(text(page.querySelector('main'))).toContain('Dates: Jun 6 – Aug 29, 2027');
      expect(text(page.querySelector('main'))).toContain('Registration deadline May 23, 2027');
      expect(text(page.querySelector('main'))).toContain('7v7 · at least 4 players');
      expect(TestBed.inject(Title).getTitle()).toBe('Summer 2027 | Coed 7v7 Rec | Omni League');
    });

    it('shows the counts in the tiles', () => {
      expect(text(page.querySelector('[data-testid="team-count"]'))).toBe('3');
      expect(text(page.querySelector('[data-testid="free-agent-count"]'))).toBe('2');
    });

    it('lists each team with a link, captain, roster against the minimum, pending invites, and the below-minimum mark', () => {
      const rows = teamRows();
      expect(rows.map((row) => text(row.querySelector('h3 a')))).toEqual([
        'Block Party',
        'Dig Deep',
        'Sand Sharks',
      ]);
      expect(rows[1].querySelector('h3 a')!.getAttribute('href')).toBe('/app/teams/tm_dig');
      expect(rows.map((row) => text(row.querySelector('[data-slot="roster"]')))).toEqual([
        '6 players · minimum 4',
        '2 of 4 players · 2 more needed',
        '4 of 4 players',
      ]);
      expect(rows.map((row) => text(row.querySelector('[data-slot="invites"]')) ?? null)).toEqual([
        null,
        '1 pending invite',
        '2 pending invites',
      ]);
      expect(rows.map((row) => text(row.querySelector('[data-slot="badge"]')) ?? null)).toEqual([
        null,
        'Below minimum',
        null,
      ]);
      expectBadge(rows[1].querySelector('[data-slot="badge"]'), 'outline-destructive', 'default');
      expect(text(rows[1])).toContain('Captain: Captain of Dig Deep');
    });

    it('lists the free agents in the order given, each with an email link and the date', () => {
      const rows = freeAgentRows();
      expect(rows.map((row) => text(row.querySelector('h3')))).toEqual(['Player 0', 'Player 1']);
      const email = rows[0].querySelector('a')!;
      expect(email.getAttribute('href')).toBe('mailto:player0@example.com');
      expect(text(email.parentElement)).toBe('Email: player0@example.com');
      const time = rows[0].querySelector('time')!;
      expect(text(time)).toBe('Sep 28, 2026');
      expect(time.getAttribute('datetime')).toMatch(/^2026-09-2[89]$/);
    });

    it('gives each free agent a Place on team button that opens a dialog, named for them', () => {
      const buttons = freeAgentRows().map((row) => row.querySelector('button')!);
      expect(buttons.map((button) => [text(button), button.getAttribute('aria-label')])).toEqual([
        ['Place on team', 'Place on team: Player 0'],
        ['Place on team', 'Place on team: Player 1'],
      ]);
      expect(buttons[0].getAttribute('aria-haspopup')).toBe('dialog');
      expect(buttons[0].type).toBe('button');
      expect(tokens(buttons[0].className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(text(page.querySelector('#free-agents'))).not.toContain(
        'No team to place them on yet',
      );
    });

    it('says nothing about a cap when every row is shown', () => {
      expect(text(page.querySelector('main'))).not.toContain('Showing the');
    });
  });

  describe('long lists', () => {
    it('says only the first 200 free agents are shown, and the tile reads 200+', async () => {
      const rows = Array.from({ length: 200 }, (_, i) => freeAgent(i));
      await open(COED, VIEW, { rows, hasMore: true });
      expect(freeAgentRows()).toHaveLength(200);
      expect(text(page.querySelector('#free-agents'))).toContain(
        'Showing the 200 who registered first. Place some to see the rest.',
      );
      expect(text(page.querySelector('[data-testid="free-agent-count"]'))).toBe('200+');
    });

    it('says how many teams exist in all when the list shows fewer', async () => {
      await open(COED, { ...VIEW, teamCount: 214 }, FREE_AGENTS);
      expect(text(page.querySelector('section[aria-labelledby="teams-heading"]'))).toContain(
        'Showing the first 3 of 214 teams.',
      );
      expect(text(page.querySelector('[data-testid="team-count"]'))).toBe('214');
    });
  });

  describe('empty states', () => {
    it('a published season with no teams says captains register them', async () => {
      await open(COED, { ...VIEW, teams: [], teamCount: 0 }, FREE_AGENTS);
      const teams = page.querySelector('section[aria-labelledby="teams-heading"]');
      expect(text(teams)).toContain('No teams yet');
      expect(text(teams)).toContain('Teams appear here when captains register them.');
    });

    it('free agents and no team: no Place on team, and a note above the list says why', async () => {
      await open(COED, { ...VIEW, teams: [], teamCount: 0 }, FREE_AGENTS);
      expect(page.querySelector('#free-agents button')).toBeNull();
      const note = page.querySelector('#free-agents [data-slot="alert"]')!;
      expect(text(note.querySelector('[data-slot="alert-title"]'))).toBe(
        'No team to place them on yet',
      );
      expect(text(note.querySelector('[data-slot="alert-description"]'))).toBe(
        'Place free agents once a team registers.',
      );
      const list = page.querySelector('#free-agents-list')!;
      expect(note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('no team and no free agents: no note', async () => {
      await open(COED, { ...VIEW, teams: [], teamCount: 0 }, { rows: [], hasMore: false });
      expect(text(page.querySelector('#free-agents'))).not.toContain(
        'No team to place them on yet',
      );
    });

    it('a draft season shows no teams and links to the league to publish it', async () => {
      await open(
        COED,
        { ...VIEW, status: 'draft', teams: [], teamCount: 0 },
        { rows: [], hasMore: false },
      );
      expect(text(page.querySelector('main'))).toContain('Draft');
      const teams = page.querySelector('section[aria-labelledby="teams-heading"]')!;
      expect(text(teams)).toContain('Teams can register once the season is published.');
      const link = teams.querySelector('a')!;
      expect(text(link)).toBe('Publish it from Coed 7v7 Rec');
      expect(link.getAttribute('href')).toBe(
        `/app/organizations/${GULF.slug}/leagues/${COED.slug}`,
      );
    });

    it('no free agents says who waits here', async () => {
      await open(COED, VIEW, { rows: [], hasMore: false });
      const panel = page.querySelector('#free-agents');
      expect(text(panel)).toContain('No free agents waiting');
      expect(text(panel)).toContain(
        'People who register without a team wait here until you place them on one.',
      );
      expect(text(page.querySelector('[data-testid="free-agent-count"]'))).toBe('0');
    });
  });

  it('a failed free-agent list shows an alert in its panel and keeps the teams', async () => {
    await open(COED, VIEW);
    o.subscription(LIST_FREE_AGENTS)!.fail(new Error('network'));
    await o.flush();
    expect(text(page.querySelector('#free-agents [role="alert"]'))).toContain(
      'The free agents could not be loaded.',
    );
    expect(teamRows()).toHaveLength(3);
  });

  it('a league organizer gets their sidebar, with the league marked but not as the page', async () => {
    await open(COED_AS_ORGANIZER, VIEW, FREE_AGENTS);
    const current = page.ownerDocument.querySelector('nav[aria-label$=" leagues"] a[aria-current]');
    expect(text(current)).toBe('Coed 7v7 Rec');
    expect(current!.getAttribute('aria-current')).toBe('true');
  });

  describe('refused and unknown', () => {
    it('FORBIDDEN from the season shows the no-access view and requests no free agents', async () => {
      o = await openAdmin(ROUTES, URL);
      page = o.page;
      o.acceptToken();
      o.subscription(GET_VIEW)!.fail(forbiddenError());
      await o.flush();
      expect(text(page.querySelector('h1'))).toBe('You can’t manage this league');
      expect(asked(LIST_FREE_AGENTS)).toEqual([]);
    });

    it('FORBIDDEN from the league shows the no-access view', async () => {
      o = await openAdmin(ROUTES, URL);
      page = o.page;
      o.acceptToken();
      o.subscription(GET_ORGANIZER_CONTEXT)!.fail(forbiddenError());
      o.subscription(GET_VIEW)!.emit(null);
      await o.flush();
      expect(text(page.querySelector('h1'))).toBe('You can’t manage this league');
    });

    it('a null season shows the not-found view and requests no free agents', async () => {
      await open(COED, null);
      expect(text(page.querySelector('h1'))).toBe('Page not found');
      expect(asked(LIST_FREE_AGENTS)).toEqual([]);
      expect(page.querySelector('#teams-list')).toBeNull();
    });

    it('a null league shows the not-found view', async () => {
      await open(null, VIEW);
      expect(text(page.querySelector('h1'))).toBe('Page not found');
    });

    it('any other failure shows the server-error view', async () => {
      o = await openAdmin(ROUTES, URL);
      page = o.page;
      o.acceptToken();
      o.subscription(GET_VIEW)!.fail(new Error('network'));
      await o.flush();
      expect(page.querySelector('app-server-error-view')).not.toBeNull();
    });
  });

  describe('placing a free agent', () => {
    const PLACE = 'freeAgents:place';
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
    const dialogButton = (label: string) =>
      [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        text(b)?.startsWith(label),
      )!;
    const radios = () => [...dialog()!.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const placeButton = (n: number) =>
      freeAgentRows()[n].querySelector<HTMLButtonElement>('button')!;
    const status = () => page.querySelector<HTMLElement>('#free-agents [role="status"]');
    const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

    afterEach(() => vi.restoreAllMocks());

    async function openDialog(n = 0) {
      await open(COED, VIEW, FREE_AGENTS);
      placeButton(n).click();
      await o.flush();
    }

    async function chooseAndPlace(n: number) {
      radios()[n].click();
      await o.flush();
      dialogButton('Place on team').click();
      await o.flush();
    }

    it('opens a dialog titled for the free agent, with each team and its roster, and focus on the first team', async () => {
      await openDialog();
      const box = dialog()!;
      expect(box.getAttribute('aria-modal')).toBe('true');
      expect(text(box.querySelector('h2'))).toBe('Place Player 0 on a team');
      expect(box.getAttribute('aria-labelledby')).toBe(box.querySelector('h2')!.id);
      expect(text(box.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
        'They join the team’s roster and can open its page. A person can be on one team in a season.',
      );
      expect(text(box.querySelector('legend'))).toBe('Team');
      expect(
        radios().map((radio) => [
          text(box.querySelector(`label[for="${radio.id}"]`)),
          text(box.querySelector(`#${radio.getAttribute('aria-describedby')}`)),
          radio.checked,
        ]),
      ).toEqual([
        ['Block Party', '6 players · minimum 4', false],
        ['Dig Deep', '2 of 4 players · 2 more needed', false],
        ['Sand Sharks', '4 of 4 players', false],
      ]);
      expect(document.activeElement).toBe(radios()[0]);
      expect(page.querySelector('app-season-management')?.hasAttribute('inert')).toBe(true);
      expect(calls()).toEqual([]);
    });

    it('a full team stays in the list, described as full, and cannot be chosen; focus goes to the first team with room', async () => {
      await open(COED, { ...VIEW, maxRosterSize: 6 }, FREE_AGENTS);
      placeButton(0).click();
      await o.flush();
      const box = dialog()!;
      expect(
        radios().map((radio) => [
          text(box.querySelector(`label[for="${radio.id}"]`)),
          text(box.querySelector(`#${radio.getAttribute('aria-describedby')}`)),
          radio.disabled,
        ]),
      ).toEqual([
        ['Block Party', 'Full: 6 of 6 players', true],
        ['Dig Deep', '2 of 4 players · 2 more needed', false],
        ['Sand Sharks', '4 of 4 players', false],
      ]);
      expect(document.activeElement).toBe(radios()[1]);
      dialogButton('Place on team').click();
      await o.flush();
      expect(document.activeElement).toBe(radios()[1]);
      expect(calls()).toEqual([]);
    });

    it('a team that filled meanwhile is refused with "The team is full."', async () => {
      await openDialog();
      await chooseAndPlace(1);
      o.convex.calls[0].reject(new ConvexError({ code: 'teamFull', message: 'The team is full.' }));
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(
        'Player 0 could not be placed. The team is full.',
      );
    });

    it('preselects the only team of a season with one', async () => {
      await open(COED, { ...VIEW, teams: [VIEW.teams[1]], teamCount: 1 }, FREE_AGENTS);
      placeButton(0).click();
      await o.flush();
      expect(radios().map((radio) => radio.checked)).toEqual([true]);
      dialogButton('Place on team').click();
      await o.flush();
      expect(calls()).toEqual([[PLACE, { freeAgentId: 'fa_0', teamId: 'tm_dig' }]]);
    });

    it('Place on team with no team chosen says to choose one, focuses the first team, and sends nothing', async () => {
      await openDialog();
      dialogButton('Place on team').click();
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="field-error"]'))).toBe('Choose a team.');
      expect(document.activeElement).toBe(radios()[0]);
      expect(calls()).toEqual([]);
      radios()[1].click();
      await o.flush();
      expect(dialog()!.querySelector('[data-slot="field-error"]')).toBeNull();
    });

    it('places on the chosen team: "Placing…" while it runs, then a status naming the team and its new count, with focus on it', async () => {
      await openDialog();
      await chooseAndPlace(1);
      expect(calls()).toEqual([[PLACE, { freeAgentId: 'fa_0', teamId: 'tm_dig' }]]);
      const busy = dialogButton('Placing');
      expect(text(busy)).toBe('Placing…');
      expect(busy.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(busy);
      expect(dialogButton('Cancel').getAttribute('aria-disabled')).toBe('true');
      o.convex.calls[0].resolve(null);
      await o.flush();
      expect(dialog()).toBeNull();
      const region = status()!;
      expect(text(region.querySelector('[data-slot="alert-title"]'))).toBe(
        'Player 0 is on Dig Deep now.',
      );
      expect(text(region.querySelector('[data-slot="alert-description"]'))).toBe(
        'Dig Deep has 3 of 4 players.',
      );
      expect(document.activeElement).toBe(region);
      expect(page.querySelector('app-season-management')?.hasAttribute('inert')).toBe(false);
    });

    it('Cancel closes it, sends nothing, and returns focus to the row’s button', async () => {
      await openDialog(1);
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(placeButton(1));
    });

    it('Escape closes it the same way', async () => {
      await openDialog(1);
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await o.flush();
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(placeButton(1));
    });

    it.each([
      [
        new ConvexError({ code: 'alreadyOnAnotherTeam', teamName: 'Sand Sharks', message: 'x' }),
        'They’re already on Sand Sharks in this season.',
      ],
      [
        new ConvexError({ code: 'alreadyPlaced', message: 'x' }),
        'They’ve already been placed on a team.',
      ],
      [new Error('Server Error: secret'), 'Check your connection and try again.'],
    ])(
      'a refusal or failure shows its alert in the dialog, with focus on it',
      async (error, line) => {
        await openDialog();
        await chooseAndPlace(0);
        o.convex.calls[0].reject(error);
        await o.flush();
        const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
        expect(text(alert)).toBe(`Player 0 could not be placed. ${line}`);
        expect(document.activeElement).toBe(alert);
        expect(text(dialog())).not.toContain('secret');
        expect(status()).toBeNull();
      },
    );

    it('offline: the button looks disabled but stays focusable; a press shows the offline alert and sends nothing', async () => {
      await openDialog();
      radios()[0].click();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      const button = dialogButton('Place on team');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.classList.contains('opacity-50')).toBe(true);
      button.click();
      await o.flush();
      const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert)).toBe(
        "You're offline. Nothing was sent. Player 0 is still waiting. Try again when you’re connected.",
      );
      expect(document.activeElement).toBe(alert);
      expect(calls()).toEqual([]);
    });

    it('a refusal from the adapter at call time shows the offline alert', async () => {
      await openDialog();
      await chooseAndPlace(0);
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(dialog()!.querySelector('[role="alert"]'))).toContain(
        'Player 0 is still waiting.',
      );
    });

    describe('the field markup the helm directives draw', () => {
      const TEAMS = [
        ['tm_block', 'Block Party'],
        ['tm_dig', 'Dig Deep'],
        ['tm_sharks', 'Sand Sharks'],
      ] as const;

      const expected = (unchosen: boolean) => [
        shapeOf('field-set', {
          id: 'place-team',
          ...(unchosen ? { 'aria-describedby': 'place-team-error' } : {}),
        }),
        shapeOf('field-legend', { id: 'place-team-legend', 'data-variant': 'label' }),
        ...TEAMS.flatMap(([teamId]) => [
          fieldShape(false, 'horizontal'),
          shapeOf('field-content'),
          shapeOf('field-label', { for: `place-team-${teamId}` }),
          shapeOf('field-description', { id: `place-team-${teamId}-description` }),
        ]),
        ...(unchosen ? [shapeOf('field-error', { id: 'place-team-error' })] : []),
      ];

      it('draws the same elements, class sets, and attributes with no team chosen yet', async () => {
        await openDialog();
        expect(formShapes(dialog()!)).toEqual(expected(false));
      });

      it('marks the Team field set as described by its error when no team was chosen', async () => {
        await openDialog();
        dialogButton('Place on team').click();
        await o.flush();
        expect(formShapes(dialog()!)).toEqual(expected(true));
      });

      const circles = () => [...dialog()!.querySelectorAll('brn-radio')];

      it('draws one radiogroup named by the Team legend, with a brn-radio per team', async () => {
        await openDialog();
        const groups = dialog()!.querySelectorAll('[role="radiogroup"]');
        expect(groups).toHaveLength(1);
        const legend = dialog()!.querySelector('legend')!;
        expect(legend.id).not.toBe('');
        expect(groups[0].getAttribute('aria-labelledby')).toBe(legend.id);
        expect([...groups[0].querySelectorAll('brn-radio')].map((radio) => radio.id)).toEqual(
          TEAMS.map(([teamId]) => `place-team-${teamId}-radio`),
        );
      });

      it('shows the invalid edge on every radio while no team is chosen after Place on team, and clears it on a choice', async () => {
        await openDialog();
        const edges = () => circles().map((el) => el.classList.contains('border-destructive'));
        expect(edges()).toEqual([false, false, false]);
        dialogButton('Place on team').click();
        await o.flush();
        expect(edges()).toEqual([true, true, true]);
        expect(dialog()!.querySelector('[role="radiogroup"]')!.hasAttribute('aria-invalid')).toBe(
          false,
        );
        radios()[1].click();
        await o.flush();
        expect(edges()).toEqual([false, false, false]);
      });

      it('keeps each radio named and tied to its label and description', async () => {
        await openDialog();
        expect(
          radios().map((radio) => [radio.id, radio.name, radio.getAttribute('aria-describedby')]),
        ).toEqual(
          TEAMS.map(([teamId]) => [
            `place-team-${teamId}`,
            'place-team',
            `place-team-${teamId}-description`,
          ]),
        );
      });
    });
  });

  describe('maximum teams', () => {
    const SET_MAX = 'seasons:setMaxTeams';
    const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
    const summary = () => text(page.querySelector('[data-testid="max-teams-summary"]'));
    const editButton = () =>
      [...page.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => text(button) === 'Edit maximum teams',
      );
    const field = () => page.querySelector<HTMLInputElement>('#edit-maximum-teams');

    async function edit(value: string) {
      editButton()!.click();
      await o.flush();
      field()!.value = value;
      field()!.dispatchEvent(new Event('input'));
      await o.flush();
    }

    async function save() {
      [...page.querySelectorAll<HTMLButtonElement>('button[type="submit"]')]
        .find((button) => text(button) === 'Save changes')!
        .click();
      await o.flush();
    }

    it('shows the limit, how many registered, that the season is full, and the tile against the limit', async () => {
      await open(COED, { ...VIEW, maxTeams: 3 }, FREE_AGENTS);
      expect(text(page.querySelector('#limits-heading'))).toBe('Limits');
      expect(summary()).toBe('3 teams · 3 registered, so the season is full');
      expect(text(page.querySelector('[data-testid="team-count"]'))).toBe('3 of 3');
    });

    it('says there is no limit, and the tile shows the count alone', async () => {
      await open(COED, VIEW, FREE_AGENTS);
      expect(summary()).toBe('No limit · 3 registered');
      expect(text(page.querySelector('[data-testid="team-count"]'))).toBe('3');
    });

    it('Edit opens the form on the field with the limit, and Cancel returns focus to Edit', async () => {
      await open(COED, { ...VIEW, maxTeams: 4 }, FREE_AGENTS);
      editButton()!.click();
      await o.flush();
      expect(field()?.value).toBe('4');
      expect(document.activeElement).toBe(field());
      expect(text(page.querySelector('#edit-maximum-teams-description'))).toBe(
        '2 to 200, or blank for no limit. At least the 3 teams already registered.',
      );
      [...page.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => text(button) === 'Cancel')!
        .click();
      await o.flush();
      expect(field()).toBeNull();
      expect(document.activeElement).toBe(editButton());
    });

    it('a value out of range shows the field error and sends nothing', async () => {
      await open(COED, VIEW, FREE_AGENTS);
      await edit('7.5');
      await save();
      expect(text(page.querySelector('#edit-maximum-teams-error'))).toBe(
        'Enter a whole number from 2 to 200, or leave it blank.',
      );
      expect(field()?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(field());
      expect(calls()).toEqual([]);
    });

    it('sends the number, then shows the saved status, focused', async () => {
      await open(COED, VIEW, FREE_AGENTS);
      await edit('6');
      await save();
      expect(calls()).toEqual([[SET_MAX, { seasonId: 'se_summer27', maxTeams: 6 }]]);
      const pending = page.querySelector('app-limit-edit-form button[type="submit"]');
      expect(text(pending)).toBe('Saving…');
      expect(pending?.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(pending);
      o.convex.calls[0].resolve(null);
      await o.flush();
      const status = page.querySelector<HTMLElement>(
        'section[aria-labelledby="limits-heading"] [role="status"]',
      );
      expect(text(status)).toBe('Maximum teams saved. The season takes up to 6 teams.');
      expect(document.activeElement).toBe(status);
      expect(field()).toBeNull();
    });

    it('blank removes the limit', async () => {
      await open(COED, { ...VIEW, maxTeams: 4 }, FREE_AGENTS);
      await edit('');
      await save();
      expect(calls()).toEqual([[SET_MAX, { seasonId: 'se_summer27', maxTeams: null }]]);
      o.convex.calls[0].resolve(null);
      await o.flush();
      expect(
        text(page.querySelector('section[aria-labelledby="limits-heading"] [role="status"]')),
      ).toBe('Maximum teams removed. There’s no limit now.');
    });

    it('a refusal below the registered teams shows the server message under the field', async () => {
      await open(COED, VIEW, FREE_AGENTS);
      await edit('2');
      await save();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'maxTeams',
          code: 'maxTeamsBelowCount',
          message: '3 teams are already registered. Enter 3 or more, or leave it blank.',
        }),
      );
      await o.flush();
      expect(text(page.querySelector('#edit-maximum-teams-error'))).toBe(
        '3 teams are already registered. Enter 3 or more, or leave it blank.',
      );
      expect(document.activeElement).toBe(field());
    });

    it('any other failure shows the form alert, focused', async () => {
      await open(COED, VIEW, FREE_AGENTS);
      await edit('8');
      await save();
      o.convex.calls[0].reject(new Error('network'));
      await o.flush();
      const alert = page.querySelector<HTMLElement>('form [data-slot="alert"]');
      expect(text(alert)).toBe(
        'The limit could not be saved. Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert);
    });

    describe('the field markup the helm directives draw', () => {
      const expected = (invalid: boolean) => [
        shapeOf('field-group', {}, 'mt-3'),
        fieldShape(invalid),
        shapeOf('field-label', { for: 'edit-maximum-teams' }),
        inputShape(
          'edit-maximum-teams',
          {
            name: 'form.value',
            type: 'text',
            inputmode: 'numeric',
            autocomplete: 'off',
            'aria-describedby': invalid
              ? 'edit-maximum-teams-description edit-maximum-teams-error'
              : 'edit-maximum-teams-description',
          },
          invalid,
        ),
        shapeOf('field-description', { id: 'edit-maximum-teams-description' }),
        ...(invalid ? [shapeOf('field-error', { id: 'edit-maximum-teams-error' })] : []),
      ];
      const limitForm = () => page.querySelector('app-limit-edit-form')!;

      it('draws the same elements, class sets, and attributes when valid', async () => {
        await open(COED, VIEW, FREE_AGENTS);
        await edit('6');
        expect(formShapes(limitForm())).toEqual(expected(false));
      });

      it('marks the limit invalid and ties its error to the input after a submit', async () => {
        await open(COED, VIEW, FREE_AGENTS);
        await edit('7.5');
        await save();
        expect(formShapes(limitForm())).toEqual(expected(true));
      });

      it('marks the limit invalid when the server refuses it', async () => {
        await open(COED, VIEW, FREE_AGENTS);
        await edit('2');
        await save();
        o.convex.calls[0].reject(
          new ConvexError({ field: 'maxTeams', code: 'maxTeamsBelowCount', message: 'No.' }),
        );
        await o.flush();
        expect(formShapes(limitForm())).toEqual(expected(true));
      });
    });

    describe('offline', () => {
      afterEach(() => vi.restoreAllMocks());

      it('the button looks disabled but stays focusable; a press shows the offline alert, sends nothing, and keeps the typed limit', async () => {
        await open(COED, VIEW, FREE_AGENTS);
        await edit('6');
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        TestBed.tick();
        await o.harness.fixture.whenStable();
        const button = page.querySelector<HTMLButtonElement>(
          'app-limit-edit-form button[type="submit"]',
        )!;
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.classList.contains('opacity-50')).toBe(true);
        expect(button.hasAttribute('disabled')).toBe(false);
        await save();
        const alert = page.querySelector<HTMLElement>('app-limit-edit-form [role="alert"]')!;
        expect(text(alert)).toBe(
          "You're offline. Nothing was sent. Your limit is still here. Try again when you’re connected.",
        );
        expect(document.activeElement).toBe(alert);
        expect(calls()).toEqual([]);
        expect(field()?.value).toBe('6');
      });
    });
  });

  describe('maximum roster size', () => {
    const SET_MAX = 'seasons:setMaxRosterSize';
    const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
    const summary = () => text(page.querySelector('[data-testid="max-roster-size-summary"]'));
    const editButton = () =>
      [...page.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => text(button) === 'Edit maximum roster size',
      );
    const field = () => page.querySelector<HTMLInputElement>('#edit-maximum-roster-size');
    const LARGEST = { name: 'Block Party', rosterCount: 6 };

    async function edit(value: string) {
      editButton()!.click();
      await o.flush();
      field()!.value = value;
      field()!.dispatchEvent(new Event('input'));
      await o.flush();
    }

    async function save() {
      [...page.querySelectorAll<HTMLButtonElement>('button[type="submit"]')]
        .find((button) => text(button) === 'Save changes')!
        .click();
      await o.flush();
    }

    it('shows the limit per team', async () => {
      await open(COED, { ...VIEW, maxRosterSize: 6, largestRoster: LARGEST }, FREE_AGENTS);
      expect(summary()).toBe('6 players per team');
    });

    it('says there is no limit', async () => {
      await open(COED, VIEW, FREE_AGENTS);
      expect(summary()).toBe('No limit');
    });

    it('Edit opens the form with the limit and the range, naming the largest roster; Cancel returns focus to its Edit', async () => {
      await open(COED, { ...VIEW, maxRosterSize: 6, largestRoster: LARGEST }, FREE_AGENTS);
      editButton()!.click();
      await o.flush();
      expect(text(page.querySelector('#edit-maximum-roster-size-heading'))).toBe(
        'Edit maximum roster size',
      );
      expect(field()?.value).toBe('6');
      expect(document.activeElement).toBe(field());
      expect(text(page.querySelector('#edit-maximum-roster-size-description'))).toBe(
        'From the minimum roster size (4) to 99, or blank for no limit. At least the largest roster (Block Party, 6 players).',
      );
      [...page.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => text(button) === 'Cancel')!
        .click();
      await o.flush();
      expect(field()).toBeNull();
      expect(document.activeElement).toBe(editButton());
    });

    it.each([
      ['7.5', 'Enter a whole number from 4 to 99, or leave it blank.'],
      ['100', 'Enter a whole number from 4 to 99, or leave it blank.'],
      ['3', 'Block Party already has 6 players. Enter 6 or more, or leave it blank.'],
      ['5', 'Block Party already has 6 players. Enter 6 or more, or leave it blank.'],
    ])('%s shows the field error and sends nothing', async (value, message) => {
      await open(COED, { ...VIEW, largestRoster: LARGEST }, FREE_AGENTS);
      await edit(value);
      await save();
      expect(text(page.querySelector('#edit-maximum-roster-size-error'))).toBe(message);
      expect(document.activeElement).toBe(field());
      expect(calls()).toEqual([]);
    });

    it('sends the number, then shows the saved status, focused; blank removes the limit', async () => {
      await open(COED, { ...VIEW, largestRoster: LARGEST }, FREE_AGENTS);
      await edit('8');
      await save();
      expect(calls()).toEqual([[SET_MAX, { seasonId: 'se_summer27', maxRosterSize: 8 }]]);
      o.convex.calls[0].resolve(null);
      await o.flush();
      const status = () =>
        page.querySelector<HTMLElement>(
          'section[aria-labelledby="limits-heading"] [role="status"]',
        );
      expect(text(status())).toBe('Maximum roster size saved. Teams can have up to 8 players.');
      expect(document.activeElement).toBe(status());
      await edit('');
      await save();
      expect(calls()[1]).toEqual([SET_MAX, { seasonId: 'se_summer27', maxRosterSize: null }]);
      o.convex.calls[1].resolve(null);
      await o.flush();
      expect(text(status())).toBe('Maximum roster size removed. There’s no limit now.');
    });

    it('a refusal from the server shows its message under the field', async () => {
      await open(COED, VIEW, FREE_AGENTS);
      await edit('6');
      await save();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'maxRosterSize',
          code: 'maxRosterSizeBelowRoster',
          message: 'Block Party already has 7 players. Enter 7 or more, or leave it blank.',
        }),
      );
      await o.flush();
      expect(text(page.querySelector('#edit-maximum-roster-size-error'))).toBe(
        'Block Party already has 7 players. Enter 7 or more, or leave it blank.',
      );
    });
  });

  describe('the waitlist', () => {
    const PROMOTE = 'waitlist:promote';
    const FULL_VIEW = { ...VIEW, maxTeams: 3 };
    const ROOM_VIEW = { ...VIEW, maxTeams: 5 };
    const rows = () => [...page.querySelectorAll<HTMLElement>('#waitlist-list > li')];
    const promoteButton = (team: string) =>
      [...page.querySelectorAll<HTMLButtonElement>('#waitlist button')].find(
        (button) => text(button) === `Promote ${team}`,
      );

    it('empty: says when teams wait here, and the tile reads 0', async () => {
      await open(COED, VIEW, FREE_AGENTS);
      const panel = page.querySelector('#waitlist');
      expect(text(panel?.querySelector('h2'))).toBe('Waitlist');
      expect(text(panel)).toContain(
        'No teams waiting When the season is full, teams that register wait here in the order they joined.',
      );
      expect(text(page.querySelector('[data-testid="waitlist-tile"]'))).toBe('0');
    });

    it('populated in a full season: the count, the no-room note, and each team oldest first with its position', async () => {
      await open(COED, FULL_VIEW, FREE_AGENTS, WAITLIST);
      expect(text(page.querySelector('[data-testid="waitlist-tile"]'))).toBe('2');
      expect(text(page.querySelector('[data-testid="waitlist-count"]'))).toBe('2 waiting');
      expect(text(page.querySelector('#waitlist [data-slot="alert"]'))).toBe(
        'The season is full Raise the maximum teams to promote a waiting team.',
      );
      expect(page.querySelector('#waitlist-list')?.tagName).toBe('OL');
      expect(rows().map((row) => text(row.querySelector('h3')))).toEqual([
        'Late Lobsters',
        'Shore Thing',
      ]);
      const first = rows()[0];
      expect(text(first)).toContain('Position 1');
      expect(text(first)).toContain('Captain: Captain 0');
      expect(first.querySelector('a')?.getAttribute('href')).toBe('mailto:captain0@example.com');
      expect(text(first)).toContain('Joined Oct 6, 2026');
      expect(tokens(promoteButton('Late Lobsters')!.className)).toEqual(tokens(OUTLINE_BUTTON));
    });

    it('with room while teams wait: says to promote to fill the places', async () => {
      await open(COED, ROOM_VIEW, FREE_AGENTS, WAITLIST);
      expect(text(page.querySelector('#waitlist [data-slot="alert"]'))).toBe(
        'Room for 2 more teams While teams are waiting, new teams still join the waitlist, so promote to fill the places.',
      );
    });

    it('promote: sends the entry, shows the pending label, then the promoted status, focused', async () => {
      await open(COED, ROOM_VIEW, FREE_AGENTS, WAITLIST);
      promoteButton('Late Lobsters')!.click();
      await o.flush();
      expect(o.convex.calls.map((c) => [c.name, c.args])).toEqual([
        [PROMOTE, { waitlistEntryId: 'wl_0' }],
      ]);
      const pending = [...page.querySelectorAll('#waitlist button')][0];
      expect(text(pending)).toBe('Promoting… Late Lobsters');
      expect(pending?.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(pending);
      o.convex.calls[0].resolve({ teamId: 'tm_late', teamCount: 4, maxTeams: 5 });
      await o.flush();
      const status = page.querySelector<HTMLElement>(
        '#waitlist [role="status"][data-slot="alert"]',
      );
      expect(text(status)).toBe(
        'Late Lobsters is a team now. Captain 0 is its captain and can invite players. The season has 4 of 5 teams.',
      );
      expect(document.activeElement).toBe(status);
    });

    it('promote refused for no room: the destructive alert, focused', async () => {
      await open(COED, FULL_VIEW, FREE_AGENTS, WAITLIST);
      promoteButton('Shore Thing')!.click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          code: 'noRoom',
          message: 'The season is full. Raise the maximum teams first.',
        }),
      );
      await o.flush();
      const alert = page.querySelector<HTMLElement>('#waitlist [role="alert"]');
      expect(text(alert)).toBe(
        'Shore Thing could not be promoted. The season is full. Raise the maximum teams first.',
      );
      expect(alert?.className).toContain('text-destructive');
      expect(document.activeElement).toBe(alert);
    });

    it('saving a raised maximum while teams wait says to promote into the new places', async () => {
      await open(COED, FULL_VIEW, FREE_AGENTS, WAITLIST);
      [...page.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => text(button) === 'Edit maximum teams')!
        .click();
      await o.flush();
      const field = page.querySelector<HTMLInputElement>('#edit-maximum-teams')!;
      field.value = '5';
      field.dispatchEvent(new Event('input'));
      await o.flush();
      [...page.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => text(button) === 'Save changes')!
        .click();
      await o.flush();
      o.convex.calls[0].resolve(null);
      await o.flush();
      expect(
        text(page.querySelector('section[aria-labelledby="limits-heading"] [role="status"]')),
      ).toBe(
        'Maximum teams saved. The season takes up to 5 teams. Teams on the waitlist keep their place: promote them to fill the 2 places.',
      );
    });
    it('offline: a press shows the offline alert and sends nothing', async () => {
      await open(COED, ROOM_VIEW, FREE_AGENTS, WAITLIST);
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      const button = promoteButton('Late Lobsters')!;
      expect(button.getAttribute('aria-disabled')).toBe('true');
      button.click();
      await o.flush();
      expect(text(page.querySelector('#waitlist [role="alert"]'))).toBe(
        "You're offline. Nothing was sent. Late Lobsters is still waiting. Try again when you’re connected.",
      );
      expect(o.convex.calls).toEqual([]);
      vi.restoreAllMocks();
      window.dispatchEvent(new Event('online'));
    });

    it('a failed waitlist shows an alert in its panel and keeps the teams', async () => {
      o = await openAdmin(ROUTES, URL);
      page = o.page;
      o.acceptToken();
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit(COED);
      o.subscription(GET_VIEW)!.emit(VIEW);
      await o.flush();
      o.subscription(LIST_FREE_AGENTS)!.emit(FREE_AGENTS);
      o.subscription(LIST_WAITLIST)!.fail(new Error('network'));
      await o.flush();
      expect(text(page.querySelector('#waitlist [role="alert"]'))).toContain(
        'The waitlist could not be loaded.',
      );
      expect(text(page.querySelector('[data-testid="waitlist-tile"]'))).toBe('–');
      expect(teamRows()).toHaveLength(3);
    });
  });
});
