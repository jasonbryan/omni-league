import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { INVITE_MESSAGES } from '../../../convex/lib/inviteInput';
import { TEAM_INVITE_MESSAGES } from '../../../convex/lib/teamInviteInput';
import { ConvexOfflineError } from '../core/data/convex';
import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { allRadiusClasses } from '../ui/testing/radius-classes';
import { TeamPage } from './team-page';
import { expectPendingSpinner } from '../ui/testing/spinner';

const GET = 'teams:getForMember';
const LIST_PENDING = 'teamInvites:listPending';
const CREATE = 'teamInvites:create';
const REVOKE = 'teamInvites:revoke';
const URL = '/app/teams/team_sharks';
const ROUTES = [{ path: 'app/teams/:teamId', component: TeamPage }];
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'Qm7Zp2vXr9LkT4cW1yNe8HsA0dUfGj3bVo6iRqKx5Ey';

const SHARKS = {
  name: 'Sand Sharks',
  organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
  league: { name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' },
  season: { name: 'Summer 2027', slug: 'summer-2027' },
  minimumRosterSize: 4,
  rosterCount: 1,
  roster: [{ rosterEntryId: 're_1', name: 'Tasha Greene', isCaptain: true, isViewer: true }],
  viewerIsCaptain: true,
  viewerCanManage: true,
};
const PENDING = {
  rows: [
    { inviteId: 'ti_devon', email: 'devon.park@example.com', expiresAt: NOW + 13 * DAY },
    { inviteId: 'ti_kai', email: 'kai.nakamura@example.com', expiresAt: NOW - DAY },
  ],
  total: 2,
};

describe('TeamPage: invites', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function open(team: object = SHARKS, pending: object | null = PENDING) {
    o = await openAdmin(ROUTES, URL);
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(team);
    await o.flush();
    if (pending) o.subscription(LIST_PENDING)?.emit(pending);
    await o.flush();
  }

  const main = () => o.harness.routeNativeElement!.querySelector('main')!;
  const email = () => main().querySelector<HTMLInputElement>('#email')!;
  const submitButton = () =>
    main().querySelector<HTMLButtonElement>('#invite button[type="submit"]')!;
  const pendingRows = () => [...main().querySelectorAll<HTMLElement>('#pending-list > li')];
  const pendingSection = () => main().querySelector('section[aria-labelledby="pending-heading"]');
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const linkBox = () => main().querySelector<HTMLTextAreaElement>('#invite-link')!;
  const copyStatus = () => main().querySelector<HTMLElement>('#copy-status')!;
  const copyButton = () =>
    [...main().querySelectorAll<HTMLButtonElement>('#invite button')].find((b) =>
      /Cop(y link|ied)/.test(b.textContent ?? ''),
    )!;

  async function type(value: string) {
    email().value = value;
    email().dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function createInvite() {
    await type('  Devon.Park@Example.com ');
    await submit();
    o.convex.calls[0].resolve({ inviteId: 'ti_new', token: TOKEN, expiresAt: NOW + 14 * DAY });
    await o.flush();
  }

  it('while the pending list loads, each row mark is rounded-lg and its text bars are rounded-md', async () => {
    await open(SHARKS, null);
    const loading = pendingSection()!.querySelector('[aria-hidden="true"].divide-y')!;
    const rows = loading.querySelectorAll(':scope > div');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(allRadiusClasses(row.querySelectorAll('[class*="animate-pulse"]'))).toEqual([
        ['rounded-lg'],
        ['rounded-md'],
        ['rounded-md'],
      ]);
    }
  });

  it('the captain sees the pending count beside the roster count, the pending list, and the form', async () => {
    await open();
    expect(o.subscription(LIST_PENDING)?.args).toEqual({ teamId: 'team_sharks' });
    expect(text(main().querySelector('[data-testid="roster-count"]'))).toBe('1 of 4 players');
    expect(text(main().querySelector('[data-testid="roster-count"]')?.parentElement)).toBe(
      '1 of 4 players · 2 pending invites',
    );
    expect(main().textContent).toContain(
      'You’re the captain. You invite players and manage the roster.',
    );
    expect(text(pendingSection()?.querySelector('h2 + p'))).toBe('2');
    expect(
      pendingRows().map((row) =>
        [...row.querySelectorAll('h3, p, button')].map((element) => text(element)),
      ),
    ).toEqual([
      [
        'devon.park@example.com',
        'Expires Oct 24, 2026',
        'Revoke the invite to devon.park@example.com',
      ],
      [
        'kai.nakamura@example.com',
        'Expired Oct 10, 2026',
        'Revoke it to invite this address again.',
        'Revoke the invite to kai.nakamura@example.com',
      ],
    ]);
    expect(text(main().querySelector('#invite-heading'))).toBe('Invite players');
    const jump = [...main().querySelectorAll('a')].find((a) => text(a) === 'Invite players');
    expect(jump?.getAttribute('href')).toBe('/app/teams/team_sharks#invite');
  });

  it('one pending invite reads in the singular, and none shows the empty state', async () => {
    await open(SHARKS, { rows: [PENDING.rows[0]], total: 1 });
    expect(text(main().querySelector('[data-testid="pending-count"]'))).toBe('1 pending invite');
    TestBed.resetTestingModule();
    await open(SHARKS, { rows: [], total: 0 });
    expect(text(main().querySelector('[data-testid="pending-count"]'))).toBe('0 pending invites');
    expect(pendingSection()?.textContent).toContain('No pending invites');
  });

  it('an organizer of the league gets the controls and the organizer line', async () => {
    await open({
      ...SHARKS,
      viewerIsCaptain: false,
      roster: [{ ...SHARKS.roster[0], isViewer: false }],
    });
    expect(main().textContent).toContain(
      'You’re an organizer of Sunday Reverse Coed 4s, so you can manage this team’s roster.',
    );
    expect(main().textContent).not.toContain('You’re the captain.');
    expect(email()).not.toBeNull();
    expect(pendingRows()).toHaveLength(2);
  });

  it('a member who cannot manage the team gets no form, no pending list, and no addresses, and asks for none', async () => {
    await open({ ...SHARKS, viewerIsCaptain: false, viewerCanManage: false }, null);
    expect(o.subscription(LIST_PENDING)).toBeUndefined();
    expect(main().querySelector('#invite')).toBeNull();
    expect(pendingSection()).toBeNull();
    expect(main().querySelector('[data-testid="pending-count"]')).toBeNull();
    expect(main().textContent).not.toContain('@');
    expect([...main().querySelectorAll('a')].some((a) => text(a) === 'Invite players')).toBe(false);
  });

  it('a pending list that fails says so and keeps the form', async () => {
    await open(SHARKS, null);
    o.subscription(LIST_PENDING)!.fail(new Error('Server Error'));
    await o.flush();
    expect(pendingSection()?.textContent).toContain('The pending invites could not be loaded.');
    expect(email()).not.toBeNull();
  });

  describe('creating an invite', () => {
    it('an empty or malformed address shows the field error and focuses Email, and sends nothing', async () => {
      await open();
      await submit();
      expect(text(main().querySelector('#email-error'))).toBe(INVITE_MESSAGES.emailEmpty);
      expect(document.activeElement).toBe(email());
      await type('x@');
      await submit();
      expect(text(main().querySelector('#email-error'))).toBe(INVITE_MESSAGES.emailInvalid);
      expect(calls()).toEqual([]);
    });

    it('sends the trimmed, lowercased address, then shows the link once with its heading focused', async () => {
      await open();
      await type('  Devon.Park@Example.com ');
      await submit();
      expect(calls()).toEqual([
        [CREATE, { teamId: 'team_sharks', email: 'devon.park@example.com' }],
      ]);
      expect(o.convex.calls[0].kind).toBe('action');
      expect(text(submitButton())).toBe('Creating invite link…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(submitButton());
      o.convex.calls[0].resolve({ inviteId: 'ti_new', token: TOKEN, expiresAt: NOW + 14 * DAY });
      await o.flush();
      expect(linkBox().value).toBe(`${window.location.origin}/teams/join#${TOKEN}`);
      expect(document.activeElement).toBe(main().querySelector('#invite-link-heading'));
      expect(main().querySelector('#invite')?.textContent).toContain(
        'Send this link to devon.park@example.com yourself, by email or text. It works until Oct 25, 2026.',
      );
    });

    it('a refusal from the server shows under Email and keeps the address', async () => {
      await open();
      await type('kai.nakamura@example.com');
      await submit();
      const message = TEAM_INVITE_MESSAGES.alreadyInvited('kai.nakamura@example.com');
      o.convex.calls[0].reject(
        new ConvexError({ field: 'email', code: 'alreadyInvited', message }),
      );
      await o.flush();
      expect(text(main().querySelector('#email-error'))).toBe(message);
      expect(email().value).toBe('kai.nakamura@example.com');
      expect(document.activeElement).toBe(email());
    });

    it('offline, the press shows the offline alert, sends nothing, and keeps the address', async () => {
      await open();
      await type('x@example.com');
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      await submit();
      expect(calls()).toEqual([]);
      const box = main().querySelector<HTMLElement>('#invite [data-slot="alert"]')!;
      expect(text(box)).toBe(
        "You're offline. Nothing was sent. The address is still here. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(box);
      expect(email().value).toBe('x@example.com');
    });

    it('any other failure shows the failure alert', async () => {
      await open();
      await type('x@example.com');
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(main().querySelector('#invite [data-slot="alert"]'))).toBe(
        'The invite could not be created. Check your connection and try again.',
      );
      expect(main().textContent).not.toContain('secret');
    });

    it('Invite someone else clears the link and the address, and focuses Email', async () => {
      await open();
      await createInvite();
      const again = [...main().querySelectorAll<HTMLButtonElement>('#invite button')].find((b) =>
        text(b)?.includes('Invite someone else'),
      )!;
      again.click();
      await o.flush();
      expect(main().querySelector('#invite-link')).toBeNull();
      expect(main().textContent).not.toContain(TOKEN);
      expect(email().value).toBe('');
      expect(document.activeElement).toBe(email());
    });

    it('a ConvexOfflineError at call time shows the offline alert', async () => {
      await open();
      await type('x@example.com');
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(main().querySelector('#invite [data-slot="alert"]'))).toContain(
        'The address is still here.',
      );
    });
  });

  describe('copying the link', () => {
    function stubClipboard(writeText: unknown) {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: writeText === undefined ? undefined : { writeText },
        configurable: true,
      });
    }
    afterEach(() => stubClipboard(undefined));

    it('writes the link, says "Copied", and keeps focus on the button', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard(writeText);
      await open();
      await createInvite();
      copyButton().focus();
      copyButton().click();
      await o.flush();
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        `${window.location.origin}/teams/join#${TOKEN}`,
      );
      expect(text(copyButton())).toBe('Copied');
      expect(text(copyStatus())).toBe('Link copied.');
      expect(document.activeElement).toBe(copyButton());
    });

    it('a blocked clipboard shows the copy-blocked message, and the link stays selectable', async () => {
      stubClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
      await open();
      await createInvite();
      copyButton().click();
      await o.flush();
      expect(text(copyStatus())).toBe('Couldn’t copy. Select the link and copy it.');
      expect(copyStatus().getAttribute('role')).toBe('status');
      expect(copyStatus().classList.contains('text-destructive')).toBe(true);
      expect(text(copyButton())).toBe('Copy link');
      expect(linkBox().readOnly).toBe(true);
      expect(linkBox().disabled).toBe(false);
      expect(linkBox().value).toBe(`${window.location.origin}/teams/join#${TOKEN}`);
    });

    it('a missing clipboard shows the same message', async () => {
      stubClipboard(undefined);
      await open();
      await createInvite();
      copyButton().click();
      await o.flush();
      expect(text(copyStatus())).toBe('Couldn’t copy. Select the link and copy it.');
    });
  });

  describe('Revoke', () => {
    const revokeButton = (n: number) =>
      pendingRows()[n].querySelector<HTMLButtonElement>('button')!;
    const statusBox = () => pendingSection()?.querySelector<HTMLElement>('[data-slot="alert"]');

    it('revokes at once, then a status above the list says so and takes focus', async () => {
      await open();
      revokeButton(1).click();
      await o.flush();
      expect(calls()).toEqual([[REVOKE, { inviteId: 'ti_kai' }]]);
      expect(o.convex.calls[0].kind).toBe('mutation');
      o.convex.calls[0].resolve(null);
      o.subscription(LIST_PENDING)!.emit({ rows: [PENDING.rows[0]], total: 1 });
      await o.flush();
      expect(statusBox()?.getAttribute('role')).toBe('status');
      expect(text(statusBox())).toBe(
        'Invite to kai.nakamura@example.com revoked. Its link no longer works. You can invite this address again.',
      );
      expect(document.activeElement).toBe(statusBox());
      expect(pendingRows()).toHaveLength(1);
    });

    it('a failed revoke shows the failure alert and keeps the row', async () => {
      await open();
      revokeButton(0).click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error'));
      await o.flush();
      expect(statusBox()?.getAttribute('role')).toBe('alert');
      expect(text(statusBox())).toBe(
        'The invite could not be revoked. Check your connection and try again.',
      );
      expect(pendingRows()).toHaveLength(2);
    });
  });
});
