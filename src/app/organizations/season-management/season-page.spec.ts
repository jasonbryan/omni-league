import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import type { Routes } from '@angular/router';
import { Elsewhere, forbiddenError, openAdmin, text } from '../admin/testing/admin-harness';
import {
  COED,
  COED_AS_ORGANIZER,
  GET_ORGANIZER_CONTEXT,
  GULF,
} from '../league/testing/league-harness';
import { SeasonPage } from './season-page';

const GET_VIEW = 'seasons:getOrganizerView';
const LIST_FREE_AGENTS = 'freeAgents:listForOrganizer';
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

describe('SeasonPage', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(league: unknown, view: unknown, freeAgents?: unknown) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(league);
    o.subscription(GET_VIEW)!.emit(view);
    await o.flush();
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

    it('asks the league and the season with the slugs, and the free agents only once both answer', async () => {
      o = await openAdmin(ROUTES, URL);
      o.acceptToken();
      expect(asked(GET_ORGANIZER_CONTEXT).map((s) => s.args)).toEqual([
        { orgSlug: GULF.slug, leagueSlug: COED.slug },
      ]);
      expect(asked(GET_VIEW).map((s) => s.args)).toEqual([SLUGS]);
      expect(asked(LIST_FREE_AGENTS)).toEqual([]);
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit(COED);
      o.subscription(GET_VIEW)!.emit(VIEW);
      await o.flush();
      expect(asked(LIST_FREE_AGENTS).map((s) => s.args)).toEqual([SLUGS]);
      expect(text(o.page.querySelector('main [role="status"]'))).toBe('Loading the season.');
    });
  });

  describe('an org admin with teams and free agents', () => {
    beforeEach(async () => {
      await open(COED, VIEW, FREE_AGENTS);
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

    it('offers no placement here', () => {
      expect(page.querySelector('#free-agents button')).toBeNull();
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
});
