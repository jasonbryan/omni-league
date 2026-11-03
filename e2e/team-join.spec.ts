import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { accountByEmail, newUser, seedUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const SEASON = 'summer-open';
const DAY = 24 * 60 * 60 * 1000;
const TEAM_KEY = 'omni.team-invite-token';
const STAFF_KEY = 'omni.invite-token';

const main = (page: Page) => page.getByRole('main');
const heading = (page: Page) => main(page).getByRole('heading', { level: 1 });
const acceptButton = (page: Page) => main(page).getByRole('button', { name: 'Accept invite' });
const newToken = () => randomBytes(32).toString('base64url');

async function seedTeam(captain: TestUser): Promise<{ tenant: Tenant; teamId: string }> {
  const tenant = await seedTenant({
    name: 'E2E Team Join',
    locations: [{ name: 'Alpha Beach', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [
      {
        name: LEAGUE,
        sport: 'beachVolleyball',
        locations: ['Alpha Beach'],
        division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
      },
    ],
  });
  await seedSeasons(tenant, LEAGUE_SLUG, [
    {
      name: 'Summer Open',
      slug: SEASON,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
    },
  ]);
  const teamId = await addTeam(tenant, 'Sand Sharks', captain);
  return { tenant, teamId };
}

async function addTeam(tenant: Tenant, name: string, captain: TestUser): Promise<string> {
  const { teamId } = (await convexRun('testing:seedTeam', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: SEASON,
    name,
    captainEmail: captain.email,
  })) as { teamId: string };
  return teamId;
}

async function seedInvite(teamId: string, email: string): Promise<string> {
  const token = newToken();
  await convexRun('testing:addTeamInvite', {
    teamId,
    email,
    expiresAt: Date.now() + 12 * DAY,
    token,
  });
  return token;
}

/**
 * The websocket carries the token as a Convex argument, which is not a URL. Playwright reports a
 * request URL with its fragment, which no request carries, so a request is judged without it; a
 * `Referer` and every later address-bar URL in full.
 */
function watchUrls(page: Page) {
  const requests: string[] = [];
  const navigations: string[] = [];
  const sent: string[] = [];
  page.on('request', (request) => {
    requests.push(request.url().split('#')[0] ?? '');
    const referer = request.headers()['referer'];
    if (referer) requests.push(referer);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => sent.push(String(frame.payload))),
  );
  return {
    sent,
    expectNone(token: string) {
      expect(requests.filter((url) => url.includes(token))).toEqual([]);
      // Skips the navigation to the link itself, which holds the fragment.
      expect(navigations.slice(1).filter((url) => url.includes(token))).toEqual([]);
    },
  };
}

const stored = (page: Page, key: string) =>
  page.evaluate((name) => sessionStorage.getItem(name), key);

async function openLink(page: Page, token: string) {
  const response = await page.goto(`/teams/join#${token}`);
  await expect(page).toHaveURL(`${baseURL}/teams/join`);
  return response;
}

async function signInWith(page: Page, user: TestUser) {
  const tokens = tokensSettled(page);
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await tokens;
}

async function expectOnlyMinorOffered(page: Page, reason: string) {
  const self = main(page).getByRole('checkbox', { name: 'Join the roster myself' });
  await expect(self).toBeDisabled();
  await expect(self).not.toBeChecked();
  await expect(main(page).locator('#join-self-description')).toHaveText(reason);
  await expect(
    main(page).getByRole('checkbox', { name: 'Add a minor I’m responsible for' }),
  ).toBeChecked();
  await expect(main(page).locator('#minor-name')).toBeVisible();
  await expect(acceptButton(page)).toBeVisible();
}

async function expectJoined(page: Page, teamId: string) {
  await expect(heading(page)).toHaveText('You’re on Sand Sharks');
  await expect(heading(page)).toBeFocused();
  await expect(page).toHaveTitle('Joined Sand Sharks | Omni League');
  const team = main(page).getByRole('link', { name: 'Go to Sand Sharks' });
  await expect(team).toHaveAttribute('href', `/app/teams/${teamId}`);
}

test.describe('Join a team: a visitor with no account', () => {
  test('signs up with the invited email and accepts: they are on the roster, the counts move, and the token reaches no URL', async ({
    page,
  }, testInfo) => {
    const captain = await seedUser(newUser('Captain'));
    const { tenant, teamId } = await seedTeam(captain);
    const user = newUser('Joiner');
    const token = await seedInvite(teamId, user.email);
    const urls = watchUrls(page);

    const response = await openLink(page, token);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(await stored(page, TEAM_KEY)).toBe(token);
    expect(await stored(page, STAFF_KEY)).toBeNull();
    await expect(heading(page)).toHaveText('Join Sand Sharks');
    await expect(page).toHaveTitle('Team invite | Omni League');
    const details = main(page).locator('dl');
    for (const value of ['Sand Sharks', 'Summer Open', LEAGUE, tenant.name]) {
      await expect(details).toContainText(value);
    }
    await expect(main(page)).not.toContainText(user.email);
    await expect(main(page)).not.toContainText(captain.name);
    await screenshot(page, testInfo, '132-signed-out');
    await expectAccessible(page);
    await expect(page.locator('header a[href^="/sign-in"]')).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Fteams%2Fjoin',
    );

    await main(page).getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-up?returnTo=%2Fteams%2Fjoin`);
    const tokens = tokensSettled(page);
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}/teams/join`, { timeout: 20_000 });
    await tokens;

    await expect(acceptButton(page)).toBeVisible();
    await expect(main(page)).toContainText(`Signed in as ${user.name}.`);
    await screenshot(page, testInfo, '132-ready');
    await expectAccessible(page);

    await acceptButton(page).click();
    await expectJoined(page, teamId);
    await expect(main(page)).toContainText(
      `You’re on the roster for Summer Open. ${captain.name} is the captain.`,
    );
    expect(await stored(page, TEAM_KEY)).toBeNull();
    await screenshot(page, testInfo, '132-accepted');
    await expectAccessible(page);

    await main(page).getByRole('link', { name: 'Go to Sand Sharks' }).click();
    await expect(page).toHaveURL(`${baseURL}/app/teams/${teamId}`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible();
    await expect(page.getByTestId('roster-count')).toHaveText('2 of 4 players');
    await expect(main(page)).toContainText(user.name);

    urls.expectNone(token);
    expect(page.url()).not.toContain(token);
  });
});

test.describe('Join a team: an account holder', () => {
  test('signs in with the invited email and accepts', async ({ page }) => {
    const captain = await seedUser(newUser('Captain'));
    const { teamId } = await seedTeam(captain);
    const user = await seedUser(newUser('Member'));
    const token = await seedInvite(teamId, user.email);
    const urls = watchUrls(page);

    await openLink(page, token);
    await main(page).getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Fteams%2Fjoin`);
    await signInWith(page, user);
    await expect(page).toHaveURL(`${baseURL}/teams/join`);
    await acceptButton(page).click();
    await expectJoined(page, teamId);
    urls.expectNone(token);
  });
});

test.describe('Join a team: refusals', () => {
  test.use({ expectedConvexErrors: ['teamInvites:accept'] });

  test('a different email is refused; switching account keeps the token out of every URL, and the invited address then accepts', async ({
    page,
  }, testInfo) => {
    const captain = await seedUser(newUser('Captain'));
    const { teamId } = await seedTeam(captain);
    const wrong = newUser('Wrong');
    const invited = await seedUser(newUser('Invited'));
    await signUp(page, wrong);
    const token = await seedInvite(teamId, invited.email);
    const urls = watchUrls(page);

    await openLink(page, token);
    await acceptButton(page).click();
    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText('This invite was sent to a different email address.');
    await expect(alert).toContainText('Sign in with that address to accept it.');
    await expect(alert).toBeFocused();
    await screenshot(page, testInfo, '132-different-email');
    await expectAccessible(page);

    await main(page).getByRole('button', { name: 'Sign in with a different account' }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Fteams%2Fjoin`);
    expect(await stored(page, TEAM_KEY)).toBe(token);
    await expect.poll(async () => (await accountByEmail(wrong.email))?.sessions).toBe(0);

    await signInWith(page, invited);
    await expect(page).toHaveURL(`${baseURL}/teams/join`);
    await acceptButton(page).click();
    await expectJoined(page, teamId);
    urls.expectNone(token);
  });

  test('someone on another team of the season is refused, naming that team, may still add a minor, and the invite stays pending', async ({
    page,
  }, testInfo) => {
    const captain = await seedUser(newUser('Captain'));
    const { tenant, teamId } = await seedTeam(captain);
    const rival = newUser('Rival');
    await signUp(page, rival);
    await addTeam(tenant, 'Net Results', rival);
    const token = await seedInvite(teamId, rival.email);

    await openLink(page, token);
    await acceptButton(page).click();
    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText('You’re already on Net Results in this season.');
    await expect(alert).toContainText(
      'Each person plays on one team per season, so you can’t join Sand Sharks yourself. You can still add a minor you’re responsible for.',
    );
    await expect(alert).toBeFocused();
    await expectOnlyMinorOffered(page, 'Not available: you’re on Net Results in this season.');
    expect(await stored(page, TEAM_KEY)).toBe(token);
    await screenshot(page, testInfo, '132-other-team');
    await expectAccessible(page);

    // The token opens the invite again: it is still pending.
    await openLink(page, token);
    await expect(heading(page)).toHaveText('Join Sand Sharks');
  });

  test('a waiting free agent of the season is refused, told an organizer places them, may still add a minor, and the invite stays pending', async ({
    page,
  }, testInfo) => {
    const captain = await seedUser(newUser('Captain'));
    const { tenant, teamId } = await seedTeam(captain);
    const freeAgent = newUser('FreeAgent');
    await signUp(page, freeAgent);
    await convexRun('testing:seedFreeAgent', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: SEASON,
      email: freeAgent.email,
    });
    const token = await seedInvite(teamId, freeAgent.email);

    await openLink(page, token);
    await acceptButton(page).click();
    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText('You’re registered as a free agent in this season.');
    await expect(alert).toContainText(
      `Organizers place free agents on teams. Ask an organizer of ${LEAGUE} to place you on Sand Sharks. You can still add a minor you’re responsible for.`,
    );
    await expect(alert).toBeFocused();
    await expectOnlyMinorOffered(page, 'Not available: an organizer places free agents.');
    expect(await stored(page, TEAM_KEY)).toBe(token);
    await screenshot(page, testInfo, '133-join-free-agent');
    await expectAccessible(page);

    await openLink(page, token);
    await expect(heading(page)).toHaveText('Join Sand Sharks');
  });
});

test.describe('Join a team: a full team', () => {
  test.use({ expectedConvexErrors: ['teamInvites:accept'] });

  test('an invite from before the team filled is refused as a whole, says nothing was added, and stays pending', async ({
    page,
  }, testInfo) => {
    const captain = await seedUser(newUser('Captain'));
    const { tenant } = await seedTeam(captain);
    await convexRun('testing:seedSeason', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      name: 'Roster Cap',
      slug: 'roster-cap',
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
      minimumRosterSize: 4,
      maxRosterSize: 4,
      status: 'published',
    });
    const fullCaptain = await seedUser(newUser('Captain'));
    const { teamId } = (await convexRun('testing:seedTeam', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: 'roster-cap',
      name: 'Sand Sharks',
      captainEmail: fullCaptain.email,
    })) as { teamId: string };
    for (const player of [await seedUser(newUser('Player')), await seedUser(newUser('Player'))]) {
      await convexRun('testing:addToTeam', { teamId, email: player.email });
    }
    const joiner = newUser('Joiner');
    await signUp(page, joiner);
    const token = await seedInvite(teamId, joiner.email);
    await convexRun('testing:addMinorToTeam', {
      teamId,
      guardianEmail: fullCaptain.email,
      minorName: 'Theo Bell',
    });

    await openLink(page, token);
    await main(page).getByRole('checkbox', { name: 'Add a minor I’m responsible for' }).click();
    await main(page).locator('#minor-name').fill('Lily Park');
    await acceptButton(page).click();
    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText('Sand Sharks is full.');
    await expect(alert).toContainText(
      'Nothing was added. If you chose two entries, there may be room for one; otherwise ask the captain whether a place opens.',
    );
    await expect(alert).toBeFocused();
    await expect(
      main(page).getByRole('checkbox', { name: 'Join the roster myself' }),
    ).toBeChecked();
    await expect(main(page).locator('#minor-name')).toHaveValue('Lily Park');
    expect(await stored(page, TEAM_KEY)).toBe(token);
    await expectAccessible(page);
    await screenshot(page, testInfo, '144-join-team-full');

    await openLink(page, token);
    await expect(heading(page)).toHaveText('Join Sand Sharks');
  });
});

test.describe('Join a team: links that cannot be used', () => {
  test('with no fragment and nothing stored, the invalid view shows and getByToken is never asked', async ({
    page,
  }, testInfo) => {
    const urls = watchUrls(page);
    await page.goto('/teams/join');
    await expect(heading(page)).toHaveText('This invite link can’t be used');
    await expect(main(page)).toContainText('Ask the team’s captain for a new link.');
    await expect(page).toHaveTitle('Invite unavailable | Omni League');
    expect(urls.sent.filter((frame) => frame.includes('teamInvites:getByToken'))).toEqual([]);
    await screenshot(page, testInfo, '132-invalid');
    await expectAccessible(page);
  });

  test('a staff invite and a team invite in one tab: each page reads only its own token, and a staff token at /teams/join is invalid', async ({
    page,
  }) => {
    const captain = await seedUser(newUser('Captain'));
    const { tenant, teamId } = await seedTeam(captain);
    const teamToken = await seedInvite(teamId, newUser('Joiner').email);
    const staffToken = newToken();
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: newUser('Staff').email,
      role: 'orgAdmin',
      leagueNames: [],
      expiresAt: Date.now() + 12 * DAY,
      token: staffToken,
    });

    await page.goto(`/invites/accept#${staffToken}`);
    await expect(heading(page)).toHaveText(`Join ${tenant.name}`);
    await openLink(page, teamToken);
    await expect(heading(page)).toHaveText('Join Sand Sharks');
    expect(await stored(page, STAFF_KEY)).toBe(staffToken);
    expect(await stored(page, TEAM_KEY)).toBe(teamToken);

    await page.goto('/invites/accept');
    await expect(heading(page)).toHaveText(`Join ${tenant.name}`);
    await page.goto('/teams/join');
    await expect(heading(page)).toHaveText('Join Sand Sharks');

    await openLink(page, staffToken);
    await expect(heading(page)).toHaveText('This invite link can’t be used');
    expect(await stored(page, TEAM_KEY)).toBeNull();
    expect(await stored(page, STAFF_KEY)).toBe(staffToken);
  });
});
