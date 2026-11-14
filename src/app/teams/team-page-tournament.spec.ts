import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ConvexError } from 'convex/values';
import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { TeamPage } from './team-page';

const GET = 'teams:getForMember';
const LIST = 'teams:listForSeasonMember';
const PENDING = 'teamInvites:listPending';
const FOR_TEAM = 'scoreReports:forTeam';

@Component({ template: '' })
class Start {}

const ROUTES = [
  { path: 'app/teams/:teamId', component: TeamPage },
  { path: 'start', component: Start },
];
const URL = '/app/teams/team_crabs';
const CRABS = {
  name: 'Sand Crabs',
  organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
  tournament: { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
  minimumRosterSize: 2,
  rosterCount: 1,
  roster: [
    {
      rosterEntryId: 're_1',
      name: 'Casey Player',
      isCaptain: true,
      isViewer: true,
      minor: null,
      viewerCanRename: false,
      viewerCanRemove: false,
    },
  ],
  viewerIsCaptain: true,
  viewerCanManage: true,
  viewerOnTeam: true,
  viewerTeamName: 'Sand Crabs',
};

describe('TeamPage: a tournament team', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;

  async function open(team: unknown = CRABS, state?: Record<string, unknown>) {
    o = await openAdmin(ROUTES, state ? '/start' : URL);
    if (state) await TestBed.inject(Router).navigateByUrl(URL, { state });
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(team);
    await o.flush();
  }

  const main = () => o.harness.routeNativeElement!.querySelector('main')!;

  it('names the tournament and the organization in the heading, each linking to its public page', async () => {
    await open();
    expect(text(main().querySelector('h1'))).toBe('Sand Crabs');
    const links = [...main().querySelectorAll('h1 + p a')].map((a) => [
      text(a),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      [
        'Gulf Coast Beach Open',
        '/organizations/gulf-coast-sport-social/tournaments/gulf-coast-beach-open',
      ],
      ['Gulf Coast Sport & Social', '/organizations/gulf-coast-sport-social'],
    ]);
    expect(document.title).toBe('Sand Crabs | Omni League');
  });

  it('renders from an answer that also carries the stand-in season and league, linking the tournament and not the season', async () => {
    await open({
      ...CRABS,
      season: { name: 'Gulf Coast Beach Open', slug: 'gulf-coast-beach-open' },
      league: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
    });
    const links = [...main().querySelectorAll('h1 + p a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/organizations/gulf-coast-sport-social/tournaments/gulf-coast-beach-open',
      '/organizations/gulf-coast-sport-social',
    ]);
    expect(main().querySelector('a[href*="/leagues/"]')).toBeNull();
    expect(text(main().querySelector('[data-testid="roster-count"]'))).toBe('1 of 2 players');
  });

  it('shows the roster against the tournament’s minimum', async () => {
    await open();
    expect(text(main().querySelector('[data-testid="roster-count"]'))).toBe('1 of 2 players');
    expect(text(main().querySelector('[data-testid="roster-note"]'))).toContain('1 more needed');
  });

  it('tells the captain they invite players and manage the roster', async () => {
    await open();
    expect(main().textContent).toContain(
      'You’re the captain. You invite players and manage the roster.',
    );
  });

  it('offers the captain the invite panel, Add a minor, the pending invites, and the tournament’s teams, and asks for the lists', async () => {
    await open();
    expect(main().querySelector('app-team-invite-panel')).not.toBeNull();
    expect(main().querySelector('app-add-minor-panel')).not.toBeNull();
    expect(main().querySelector('app-team-pending-invites')).not.toBeNull();
    expect(main().querySelector('app-season-teams-panel')).not.toBeNull();
    expect(main().querySelector('a[href$="#invite"]')).not.toBeNull();
    expect(o.subscription(PENDING)?.args).toEqual({ teamId: 'team_crabs' });
    expect(o.subscription(LIST)?.args).toEqual({ teamId: 'team_crabs' });
  });

  it('shows the captain the Report score panel above the roster, and asks for the team’s game', async () => {
    await open();
    const panel = main().querySelector('app-score-report-panel')!;
    expect(panel).not.toBeNull();
    expect(
      panel.compareDocumentPosition(
        main().querySelector('section[aria-labelledby="roster-heading"]')!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(o.subscription(FOR_TEAM)?.args).toEqual({ teamId: 'team_crabs' });
    o.subscription(FOR_TEAM)!.emit({ sport: 'beachVolleyball', setsPerGame: 1, game: null });
    await o.flush();
    expect(text(panel.querySelector('h2'))).toBe('Report score');
    expect(text(panel.querySelector('[data-slot="empty"] p'))).toBe('No game to report right now.');
  });

  it('shows a player who is not the captain no Report score panel, and asks for no game', async () => {
    await open({
      ...CRABS,
      viewerIsCaptain: false,
      viewerCanManage: false,
      roster: [{ ...CRABS.roster[0], isCaptain: false }],
    });
    expect(main().querySelector('app-score-report-panel')).toBeNull();
    expect(o.subscription(FOR_TEAM)).toBeUndefined();
  });

  it('shows an organizer on no roster no Report score panel', async () => {
    await open({
      ...CRABS,
      viewerIsCaptain: false,
      viewerOnTeam: false,
      viewerTeamName: null,
      roster: [{ ...CRABS.roster[0], isViewer: false }],
    });
    expect(main().querySelector('app-score-report-panel')).toBeNull();
    expect(o.subscription(FOR_TEAM)).toBeUndefined();
  });

  it('names the teams panel for the tournament, and links each team', async () => {
    await open();
    o.subscription(LIST)!.emit({
      rows: [
        { teamId: 'team_crabs', name: 'Sand Crabs', isViewerTeam: true },
        { teamId: 'team_net', name: 'Net Results', isViewerTeam: false },
      ],
      total: 2,
    });
    await o.flush();
    const panel = main().querySelector('app-season-teams-panel')!;
    expect(text(panel.querySelector('h2'))).toBe('Teams in this tournament');
    expect(text(panel.querySelector('[data-testid="season-teams-count"]'))).toBe('2 teams');
    expect([...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/app/teams/team_crabs',
      '/app/teams/team_net',
    ]);
  });

  it('shows a player who is not the captain Add a minor, and neither the invite panel nor the pending invites', async () => {
    await open({
      ...CRABS,
      viewerIsCaptain: false,
      viewerCanManage: false,
      roster: [{ ...CRABS.roster[0], isCaptain: false }],
    });
    expect(main().querySelector('app-add-minor-panel')).not.toBeNull();
    expect(main().querySelector('app-team-invite-panel')).toBeNull();
    expect(main().querySelector('app-team-pending-invites')).toBeNull();
    expect(main().querySelector('a[href$="#invite"]')).toBeNull();
    expect(o.subscription(PENDING)).toBeUndefined();
    expect(o.subscription(LIST)).toBeDefined();
  });

  it('shows a player on another team the roster and the tournament’s teams, with neither Add a minor nor an invite', async () => {
    await open({
      ...CRABS,
      viewerIsCaptain: false,
      viewerCanManage: false,
      viewerOnTeam: false,
      viewerTeamName: 'Net Results',
      roster: [{ ...CRABS.roster[0], isViewer: false }],
    });
    expect(text(main().querySelector('[data-testid="viewer-note"]'))).toBe(
      'You’re on Net Results. Teams in a tournament see each other’s rosters, so everyone who plays is listed.',
    );
    expect(main().querySelector('app-add-minor-panel')).toBeNull();
    expect(main().querySelector('app-team-invite-panel')).toBeNull();
    expect(main().querySelector('app-season-teams-panel')).not.toBeNull();
  });

  it('offers Remove on a row the roster says the viewer may remove', async () => {
    await open({
      ...CRABS,
      roster: [
        CRABS.roster[0],
        {
          ...CRABS.roster[0],
          rosterEntryId: 're_2',
          name: 'Sam Player',
          isCaptain: false,
          isViewer: false,
          viewerCanRemove: true,
        },
      ],
    });
    expect(main().querySelectorAll('button[data-roster-entry-id]')).toHaveLength(1);
    expect(main().querySelector('app-remove-player-dialog')).not.toBeNull();
  });

  it('confirms a fresh registration for the tournament in a status that takes focus', async () => {
    await open(CRABS, { registered: true });
    const status = main().querySelector('[role="status"]');
    expect(text(status)).toBe(
      'Sand Crabs is registered for Gulf Coast Beach Open. Invite your players next. Each invite link is shown once.',
    );
    expect(document.activeElement).toBe(status);
  });

  it('FORBIDDEN for a tournament team says who may see it, for a tournament', async () => {
    o = await openAdmin(ROUTES, URL);
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.fail(new ConvexError({ code: 'FORBIDDEN', team: 'tournament' }));
    await o.flush();
    expect(text(main().querySelector('h1'))).toBe('You can’t open this team page');
    expect(text(main().querySelector('h1 + p'))).toBe(
      'Only the players on teams in its tournament and the people who run it can see it. If you were removed from the team, ask the captain to invite you again.',
    );
  });

  it('tells an organizer on no roster which tournament they organize, and that they manage the roster', async () => {
    await open({
      ...CRABS,
      viewerIsCaptain: false,
      viewerOnTeam: false,
      viewerTeamName: null,
      roster: [{ ...CRABS.roster[0], isViewer: false }],
    });
    expect([...main().querySelectorAll('h1 ~ p')].map(text)).toContain(
      'You’re an organizer of Gulf Coast Beach Open, so you can manage this team’s roster.',
    );
  });
});
