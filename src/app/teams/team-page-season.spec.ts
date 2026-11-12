import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { seasonTeamsCount } from './season-teams-panel';
import { TeamPage } from './team-page';
import { expectBadge } from '../ui/testing/badge';

const GET = 'teams:getForMember';
const LIST = 'teams:listForSeasonMember';
const PENDING = 'teamInvites:listPending';
@Component({ template: '' })
class Start {}

const ROUTES = [
  { path: 'app/teams/:teamId', component: TeamPage },
  { path: 'start', component: Start },
];
const PARTY = {
  name: 'Block Party',
  organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
  league: { name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' },
  season: { name: 'Summer 2027', slug: 'summer-2027' },
  minimumRosterSize: 4,
  rosterCount: 2,
  roster: [
    { rosterEntryId: 're_1', name: 'Jalen Brooks', isCaptain: true, isViewer: false },
    { rosterEntryId: 're_2', name: 'Priya Shah', isCaptain: false, isViewer: false },
  ],
  viewerIsCaptain: false,
  viewerCanManage: false,
  viewerTeamName: 'Sand Sharks',
};
const TEAMS = {
  rows: [
    { teamId: 'team_party', name: 'Block Party', isViewerTeam: false },
    { teamId: 'team_sharks', name: 'Sand Sharks', isViewerTeam: true },
    { teamId: 'team_shore', name: 'Shore Thing', isViewerTeam: false },
  ],
  total: 3,
};

describe('TeamPage: rosters in a season', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;

  async function open(team: unknown, url = '/app/teams/team_party') {
    o = await openAdmin(ROUTES, url);
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(team);
    await o.flush();
  }

  const main = () => o.harness.routeNativeElement!.querySelector('main')!;
  const seasonPanel = () => main().querySelector('section[aria-labelledby="season-teams-heading"]');
  const seasonLinks = () =>
    [...(seasonPanel()?.querySelectorAll('a') ?? [])].map((a) => [
      text(a),
      a.getAttribute('href'),
      a.getAttribute('aria-current'),
    ]);

  it('an opponent sees the roster names and captain mark, a note naming their team, and no control, email, or pending invite', async () => {
    await open(PARTY);
    expect(text(main().querySelector('[data-testid="viewer-note"]'))).toBe(
      'You’re on Sand Sharks. Teams in a season see each other’s rosters, so everyone who plays is listed.',
    );
    const roster = main().querySelector('section[aria-labelledby="roster-heading"]')!;
    expect([...roster.querySelectorAll('h3')].map(text)).toEqual(['Jalen Brooks', 'Priya Shah']);
    expect(text(roster.querySelector('[data-slot="badge"]'))).toBe('Captain');
    expectBadge(roster.querySelector('[data-slot="badge"]'), 'secondary', 'default');
    expect(main().querySelectorAll('button')).toHaveLength(0);
    expect(main().querySelector('#pending-heading')).toBeNull();
    expect(main().querySelector('app-team-invite-panel')).toBeNull();
    expect(main().textContent).not.toContain('Invite players');
    expect(o.subscription(PENDING)).toBeUndefined();
  });

  it('a teammate who is not the captain is told who the captain is', async () => {
    await open({
      ...PARTY,
      roster: [PARTY.roster[0], { ...PARTY.roster[1], isViewer: true }],
      viewerTeamName: 'Block Party',
    });
    expect(text(main().querySelector('[data-testid="viewer-note"]'))).toBe(
      'You’re on this team. Jalen Brooks is the captain.',
    );
  });

  it('an organizer on no roster gets the organizer line and no viewer note', async () => {
    await open({ ...PARTY, viewerCanManage: true, viewerTeamName: null });
    expect(main().querySelector('[data-testid="viewer-note"]')).toBeNull();
    expect(main().textContent).toContain('You’re an organizer of Sunday Reverse Coed 4s');
  });

  it('lists the season’s teams with this team current and the viewer’s team marked', async () => {
    await open(PARTY);
    expect(o.subscription(LIST)?.args).toEqual({ teamId: 'team_party' });
    expect(text(seasonPanel()?.querySelector('[role="status"]'))).toBe(
      'Loading the season’s teams.',
    );
    o.subscription(LIST)!.emit(TEAMS);
    await o.flush();
    expect(text(seasonPanel()?.querySelector('[data-testid="season-teams-count"]'))).toBe(
      '3 teams',
    );
    expect(seasonLinks()).toEqual([
      ['Block Party This team', '/app/teams/team_party', 'page'],
      ['Sand Sharks Your team', '/app/teams/team_sharks', null],
      ['Shore Thing', '/app/teams/team_shore', null],
    ]);
    const [thisTeam, yourTeam] = [...seasonPanel()!.querySelectorAll('[data-slot="badge"]')];
    expectBadge(thisTeam, 'outline', 'default');
    expectBadge(yourTeam, 'secondary', 'default');
  });

  it('a failed list shows an error inside the panel and leaves the roster', async () => {
    await open(PARTY);
    o.subscription(LIST)!.fail(new Error('offline'));
    await o.flush();
    expect(text(seasonPanel()?.querySelector('[data-slot="alert"]'))).toContain(
      'The season’s teams could not be loaded.',
    );
    expect(main().querySelector('section[aria-labelledby="roster-heading"]')).not.toBeNull();
  });

  it('following a team link asks for that team, and a notice about the last team does not follow', async () => {
    o = await openAdmin(ROUTES, '/start');
    o.acceptToken();
    await TestBed.inject(Router).navigateByUrl('/app/teams/team_sharks', {
      state: { registered: true },
    });
    await o.flush();
    o.subscription(GET)!.emit({ ...PARTY, name: 'Sand Sharks', viewerIsCaptain: true });
    await o.flush();
    expect(main().querySelector('app-admin-alert[kind="success"]')).not.toBeNull();
    await TestBed.inject(Router).navigateByUrl('/app/teams/team_shore');
    await o.flush();
    expect(o.subscription(GET)?.args).toEqual({ teamId: 'team_shore' });
    o.subscription(GET)!.emit({ ...PARTY, name: 'Shore Thing' });
    await o.flush();
    expect(text(main().querySelector('h1'))).toBe('Shore Thing');
    expect(main().querySelector('app-admin-alert[kind="success"]')).toBeNull();
  });
});

describe('seasonTeamsCount', () => {
  it.each([
    [1, 1, '1 team'],
    [8, 8, '8 teams'],
    [200, 201, '200 of 201 teams'],
  ])('%i shown of %i reads "%s"', (shown, total, expected) => {
    expect(seasonTeamsCount(shown, total)).toBe(expected);
  });
});
