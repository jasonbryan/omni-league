import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { TeamPage } from './team-page';

const GET = 'teams:getForMember';
const LIST = 'teams:listForSeasonMember';
const PENDING = 'teamInvites:listPending';

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

  it('shows the roster against the tournament’s minimum', async () => {
    await open();
    expect(text(main().querySelector('[data-testid="roster-count"]'))).toBe('1 of 2 players');
    expect(text(main().querySelector('[data-testid="roster-note"]'))).toContain('1 more needed');
  });

  it('tells the captain they are the captain, without promising invites', async () => {
    await open();
    expect(main().textContent).toContain('You’re the captain.');
    expect(main().textContent).not.toContain('invite');
    expect(main().textContent).not.toContain('Invite');
  });

  it('offers no invite, minor, pending invite, or season teams panel and asks for none', async () => {
    await open();
    expect(main().querySelector('app-team-invite-panel')).toBeNull();
    expect(main().querySelector('app-add-minor-panel')).toBeNull();
    expect(main().querySelector('app-season-teams-panel')).toBeNull();
    expect(main().querySelector('#pending-heading')).toBeNull();
    expect(main().querySelector('a[href$="#invite"]')).toBeNull();
    expect(o.subscription(PENDING)).toBeUndefined();
    expect(o.subscription(LIST)).toBeUndefined();
  });

  it('confirms a fresh registration for the tournament in a status that takes focus', async () => {
    await open(CRABS, { registered: true });
    const status = main().querySelector('[role="status"]');
    expect(text(status)).toBe(
      'Sand Crabs is registered for Gulf Coast Beach Open. You’re the captain and the first player on the roster.',
    );
    expect(document.activeElement).toBe(status);
  });

  it('tells an organization admin on no roster that they can manage the team', async () => {
    await open({
      ...CRABS,
      viewerIsCaptain: false,
      viewerOnTeam: false,
      viewerTeamName: null,
      roster: [{ ...CRABS.roster[0], isViewer: false }],
    });
    expect(main().textContent).toContain('You’re an organizer of Gulf Coast Sport & Social');
  });
});
