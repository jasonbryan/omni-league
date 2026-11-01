import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { forbiddenError, openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { TeamPage } from './team-page';

@Component({ template: '<a id="go" href="/app/teams/team_sharks">go</a>' })
class Start {}

const GET = 'teams:getForMember';
const URL = '/app/teams/team_sharks';
const ROUTES = [
  { path: 'app/teams/:teamId', component: TeamPage },
  { path: 'start', component: Start },
];
const SHARKS = {
  name: 'Sand Sharks',
  organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
  league: { name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' },
  season: { name: 'Summer 2027', slug: 'summer-2027' },
  minimumRosterSize: 4,
  rosterCount: 1,
  roster: [{ rosterEntryId: 're_1', name: 'Tasha Greene', isCaptain: true, isViewer: true }],
  viewerIsCaptain: true,
};

describe('TeamPage', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;

  async function open(url = URL) {
    o = await openAdmin(ROUTES, url);
    o.acceptToken();
    await o.flush();
  }

  async function answer(value: unknown) {
    o.subscription(GET)!.emit(value);
    await o.flush();
  }

  const main = () => o.harness.routeNativeElement!.querySelector('main')!;
  const rosterRows = () =>
    [...main().querySelectorAll('section ul > li')].map((li) =>
      [
        text(li.querySelector('[aria-hidden="true"]')),
        text(li.querySelector('h3')),
        text(li.querySelector('[data-slot="badge"]')),
      ].filter(Boolean),
    );

  it('asks teams.getForMember with the id from the path once the token is accepted, behind a skeleton', async () => {
    await open();
    expect(o.subscription(GET)?.args).toEqual({ teamId: 'team_sharks' });
    expect(text(main().querySelector('[role="status"]'))).toBe('Loading the team.');
  });

  it('shows the team, its links, the captain line, and the roster against the minimum', async () => {
    await open();
    await answer(SHARKS);
    expect(text(main().querySelector('h1'))).toBe('Sand Sharks');
    const links = [...main().querySelectorAll('h1 + p a')].map((a) => [
      text(a),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      [
        'Summer 2027',
        '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s/seasons/summer-2027',
      ],
      [
        'Sunday Reverse Coed 4s',
        '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s',
      ],
      ['Gulf Coast Sport & Social', '/organizations/gulf-coast-sport-social'],
    ]);
    expect(main().textContent).toContain('You’re the captain.');
    expect(text(main().querySelector('[data-testid="roster-count"]'))).toBe('1 of 4 players');
    expect(text(main().querySelector('[data-testid="roster-note"]'))).toBe(
      '3 more needed to reach the minimum of 4 players.',
    );
    expect(rosterRows()).toEqual([['TG', 'Tasha Greene (you)', 'Captain']]);
    expect(document.title).toBe('Sand Sharks | Omni League');
    expect(main().querySelector('[data-slot="alert"]')).toBeNull();
  });

  it('a player who is not the captain gets no captain line and no "(you)" on the captain', async () => {
    await open();
    await answer({
      ...SHARKS,
      rosterCount: 4,
      roster: [
        { rosterEntryId: 're_1', name: 'Tasha Greene', isCaptain: true, isViewer: false },
        { rosterEntryId: 're_2', name: 'Demo Player', isCaptain: false, isViewer: true },
        { rosterEntryId: 're_3', name: 'Ana Ruiz', isCaptain: false, isViewer: false },
        { rosterEntryId: 're_4', name: 'Ben Ode', isCaptain: false, isViewer: false },
      ],
      viewerIsCaptain: false,
    });
    expect(main().textContent).not.toContain('You’re the captain.');
    expect(text(main().querySelector('[data-testid="roster-count"]'))).toBe('4 of 4 players');
    expect(text(main().querySelector('[data-testid="roster-note"]'))).toBe(
      'The roster meets the minimum of 4 players.',
    );
    expect(rosterRows()).toEqual([
      ['TG', 'Tasha Greene', 'Captain'],
      ['DP', 'Demo Player (you)'],
      ['AR', 'Ana Ruiz'],
      ['BO', 'Ben Ode'],
    ]);
  });

  it('after registering, a status confirms it and takes focus', async () => {
    o = await openAdmin(ROUTES, '/start');
    o.acceptToken();
    await TestBed.inject(Router).navigateByUrl(URL, { state: { registered: true } });
    await o.flush();
    await answer(SHARKS);
    const status = main().querySelector<HTMLElement>('[data-slot="alert"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(text(status)).toBe(
      'Sand Sharks is registered for Summer 2027. You’re its captain and first player.',
    );
    expect(document.activeElement).toBe(status);
  });

  it('a null answer (an unknown or malformed id) shows the not-found view', async () => {
    await open('/app/teams/not-an-id');
    expect(o.subscription(GET)?.args).toEqual({ teamId: 'not-an-id' });
    await answer(null);
    expect(text(main().querySelector('h1'))).toBe('Page not found');
  });

  it('FORBIDDEN shows the no-access view', async () => {
    await open();
    o.subscription(GET)!.fail(forbiddenError());
    await o.flush();
    expect(text(main().querySelector('h1'))).toBe('You can’t open this team page');
    expect(main().querySelector('a[href="/app"]')).not.toBeNull();
    expect(document.title).toBe('No access | Omni League');
  });

  it('any other failure shows the server-error view with a retry to this page', async () => {
    await open();
    o.subscription(GET)!.fail(new Error('connect ECONNREFUSED internal-db'));
    await o.flush();
    expect(o.harness.routeNativeElement!.querySelector('app-server-error-view')).not.toBeNull();
    expect(main().textContent).not.toContain('internal-db');
  });
});
