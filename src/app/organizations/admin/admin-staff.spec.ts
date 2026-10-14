import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { INVITE_MESSAGES } from '../../../../convex/lib/inviteInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { AdminArea } from './admin-area';
import { AdminStaff } from './admin-staff';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import {
  adminRoutes,
  COASTAL,
  GET_ADMIN_CONTEXT,
  ME,
  openAdmin,
  text,
} from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [{ path: 'staff', component: AdminStaff }]);
const URL = `/app/organizations/${COASTAL.slug}/staff`;
const LIST_MEMBERS = 'memberships:listForOrganization';
const LIST_PENDING = 'invites:listPending';
const LIST_LEAGUES = 'leagues:listForAdmin';
const CREATE = 'invites:create';
const REVOKE = 'invites:revoke';
const RESTORE = 'invites:restore';
const tokens = (value: string) => value.split(' ').sort();

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const MEMBERS = [
  {
    name: 'Luis Herrera',
    email: 'luis.herrera@example.com',
    role: 'orgAdmin',
    leagueNames: [],
    isYou: false,
  },
  {
    name: 'Maya Okafor',
    email: 'maya.okafor@example.com',
    role: 'orgAdmin',
    leagueNames: [],
    isYou: true,
  },
  {
    name: 'Priya Natarajan',
    email: 'priya.natarajan@example.com',
    role: 'leagueOrganizer',
    leagueNames: ['Sunday Reverse Coed 4s', 'Thursday Night Coed 2s'],
    isYou: false,
  },
];

const PENDING = [
  {
    inviteId: 'inv_dana',
    email: 'dana.whitlock@example.com',
    role: 'leagueOrganizer',
    leagueNames: ['Wednesday Coed Slow-Pitch'],
    expiresAt: NOW + 12 * DAY,
  },
  {
    inviteId: 'inv_castillo',
    email: 'r.castillo@example.com',
    role: 'leagueOrganizer',
    leagueNames: ['Coed 7v7 Rec'],
    expiresAt: NOW - 9 * DAY,
  },
];

const LEAGUES = [
  {
    leagueId: 'lg_7v7',
    name: 'Coed 7v7 Rec',
    slug: 'coed-7v7-rec',
    sportName: 'Soccer',
    status: 'published',
    locationNames: ['A'],
  },
  {
    leagueId: 'lg_4s',
    name: 'Sunday Reverse Coed 4s',
    slug: 'sunday-reverse-coed-4s',
    sportName: 'Beach volleyball',
    status: 'draft',
    locationNames: ['B'],
  },
  {
    leagueId: 'lg_2s',
    name: 'Thursday Night Coed 2s',
    slug: 'thursday-night-coed-2s',
    sportName: 'Beach volleyball',
    status: 'draft',
    locationNames: ['B'],
  },
  {
    leagueId: 'lg_slow',
    name: 'Wednesday Coed Slow-Pitch',
    slug: 'wednesday-coed-slow-pitch',
    sportName: 'Softball',
    status: 'draft',
    locationNames: ['C'],
  },
];

const TOKEN = 'vT3kq9Xo-PwGYsFI6eyKfmW2cGdPZEabYr7_hN1uLcA';

describe('AdminStaff', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function open(
    lists: { members?: unknown[]; pending?: unknown[]; leagues?: unknown[] } = {},
  ) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    if (lists.members) o.subscription(LIST_MEMBERS)!.emit(lists.members);
    if (lists.pending) o.subscription(LIST_PENDING)!.emit(lists.pending);
    if (lists.leagues) o.subscription(LIST_LEAGUES)!.emit(lists.leagues);
    await o.flush();
  }
  const openFull = () => open({ members: MEMBERS, pending: PENDING, leagues: LEAGUES });

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#invite form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const members = () => [...page.querySelectorAll<HTMLElement>('#members-list > li')];
  const pending = () => [...page.querySelectorAll<HTMLElement>('#pending-list > li')];
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const league = (n: number) => page.querySelector<HTMLButtonElement>(`#league-${n}`)!;
  const pendingSection = () => page.querySelector('section[aria-labelledby="pending-heading"]')!;

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function chooseRole(id: 'role-organizer' | 'role-admin') {
    const radio = input(id);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function toggleLeague(n: number) {
    league(n).click();
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function fill() {
    await type('email', 'Jordan.Mills@Example.com ');
    await toggleLeague(4);
  }

  async function createInvite() {
    await fill();
    await submit();
    o.convex.calls[0].resolve({ inviteId: 'inv_new', token: TOKEN, expiresAt: NOW + 14 * DAY });
    await o.flush();
  }

  const heading = () => page.querySelector<HTMLElement>('#invite-link-heading');
  const linkBox = () => page.querySelector<HTMLTextAreaElement>('#invite-link')!;
  const copyButton = () =>
    [...page.querySelectorAll<HTMLButtonElement>('#invite button')].find((b) =>
      /Cop(y link|ied)/.test(b.textContent ?? ''),
    )!;
  const copyStatus = () => page.querySelector<HTMLElement>('#copy-status')!;
  const expectedLink = () => `${window.location.origin}/invites/accept#${TOKEN}`;

  describe('the page (states 1 and 2)', () => {
    it('asks the staff, pending, and league lists with the organization id, only after the context says ready', async () => {
      await open();
      expect(o.convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [ME, {}],
        [LIST_MEMBERS, { organizationId: COASTAL.organizationId }],
        [LIST_PENDING, { organizationId: COASTAL.organizationId }],
        [LIST_LEAGUES, { organizationId: COASTAL.organizationId }],
      ]);
    });

    it('has the organization, the h1, the sentence, and the title', async () => {
      await openFull();
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Staff');
      expect(text(main.querySelector('h1 + p'))).toBe(
        'Org admins manage everything here. League organizers run the leagues you assign them.',
      );
      expect(TestBed.inject(Title).getTitle()).toBe('Staff | Coastal Bend Rec Club | Omni League');
    });

    it('lists each member with name, "(you)", email, and role, a league organizer with their leagues', async () => {
      await openFull();
      expect(members().map((li) => text(li.querySelector('h3')))).toEqual([
        'Luis Herrera',
        'Maya Okafor (you)',
        'Priya Natarajan',
      ]);
      expect(members().map((li) => text(li.querySelector('p')))).toEqual([
        'luis.herrera@example.com',
        'maya.okafor@example.com',
        'priya.natarajan@example.com',
      ]);
      const badge = (li: HTMLElement) => text(li.querySelector('[data-slot="badge"]'));
      expect(members().map(badge)).toEqual(['Org admin', 'Org admin', 'League organizer']);
      expect(text(members()[2].querySelectorAll('p')[1])).toBe(
        'League organizer for Sunday Reverse Coed 4s, Thursday Night Coed 2s',
      );
      expect(members()[0].querySelector('[data-variant="secondary"]')).not.toBeNull();
      expect(text(members()[0].querySelector('[aria-hidden="true"]'))).toBe('LH');
    });

    it('lists each pending invite with email, role and leagues, and its expiry, and a Revoke button', async () => {
      await openFull();
      expect(pending().map((li) => text(li.querySelector('h3')))).toEqual([
        'dana.whitlock@example.com',
        'r.castillo@example.com',
      ]);
      const first = pending()[0];
      expect(text(first.querySelectorAll('p')[0])).toBe(
        'League organizer for Wednesday Coed Slow-Pitch',
      );
      expect(text(first.querySelectorAll('p')[1])).toBe('Expires Oct 23, 2026');
      const revoke = first.querySelector<HTMLButtonElement>('button')!;
      expect(text(revoke)).toBe('Revoke the invite to dana.whitlock@example.com');
      expect(revoke.querySelector('.sr-only')?.textContent).toBe(
        ' the invite to dana.whitlock@example.com',
      );
      expect(tokens(revoke.className)).toEqual(tokens(DESTRUCTIVE_BUTTON));
      expect(revoke.getAttribute('type')).toBe('button');
      expect(first.querySelector('a')).toBeNull();
    });

    it('an org admin invite reads "Org admin"', async () => {
      await open({
        members: MEMBERS,
        pending: [{ ...PENDING[0], role: 'orgAdmin', leagueNames: [] }],
        leagues: LEAGUES,
      });
      expect(text(pending()[0].querySelectorAll('p')[0])).toBe('Org admin');
    });

    it('an invite whose expiry has passed stays listed as "Expired <date>", in words and an icon, with the hint and Revoke', async () => {
      await openFull();
      const expired = pending()[1];
      const line = expired.querySelectorAll('p')[1];
      expect(text(line)).toBe('Expired Oct 2, 2026');
      expect(line.classList.contains('text-destructive')).toBe(true);
      expect(line.querySelector('ng-icon')).not.toBeNull();
      expect(text(expired.querySelectorAll('p')[2])).toBe(
        'Revoke it to invite this address again.',
      );
      expect(expired.querySelector('button')).not.toBeNull();
      expect(text(pending()[0])).not.toContain('Expired');
    });

    it('treats the moment of expiry as expired', async () => {
      await open({
        members: MEMBERS,
        pending: [{ ...PENDING[0], expiresAt: NOW }],
        leagues: LEAGUES,
      });
      expect(text(pending()[0])).toContain('Expired Oct 11, 2026');
    });

    it('no pending invites (state 2): the empty state', async () => {
      await open({ members: MEMBERS, pending: [], leagues: LEAGUES });
      const section = pendingSection();
      expect(text(section.querySelector('p.font-medium'))).toBe('No pending invites');
      expect(text(section)).toContain(
        'Invites you create wait here until they’re accepted or revoked.',
      );
      expect(section.querySelector('ul')).toBeNull();
    });

    it('loading: placeholders and polite statuses', async () => {
      await open();
      const membersSection = page.querySelector('section[aria-labelledby="members-heading"]')!;
      expect(text(membersSection.querySelector('[role="status"]'))).toBe('Loading the staff.');
      expect(text(pendingSection().querySelector('[role="status"]'))).toBe(
        'Loading the pending invites.',
      );
      expect(membersSection.querySelector('ul')).toBeNull();
      expect(pendingSection().querySelector('ul')).toBeNull();
      expect(text(page.querySelector('#invite [role="status"]'))).toBe('Loading the leagues.');
      expect(page.querySelector('#invite form')).toBeNull();
    });

    it('a failed list shows the destructive alert, never the error message', async () => {
      await open({ leagues: LEAGUES });
      o.subscription(LIST_MEMBERS)!.fail(new Error('Server Error: secret'));
      o.subscription(LIST_PENDING)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alerts = [...page.querySelectorAll('[role="alert"]')].map((a) => text(a));
      expect(alerts).toEqual([
        'The staff could not be loaded. Check your connection and try again.',
        'The pending invites could not be loaded. Check your connection and try again.',
      ]);
      expect(page.textContent).not.toContain('secret');
    });

    it('lists an invite created elsewhere at once (the list is live)', async () => {
      await openFull();
      o.subscription(LIST_PENDING)!.emit([
        ...PENDING,
        { ...PENDING[0], inviteId: 'inv_x', email: 'x@example.com' },
      ]);
      await o.flush();
      expect(pending()).toHaveLength(3);
    });
  });

  describe('the "Invite staff" jump link (phones)', () => {
    it('is hidden from 1024px, targets the form, and moves focus and scroll to Email', async () => {
      await openFull();
      const link = page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      expect(text(link)).toBe('Invite staff');
      expect(link.getAttribute('href')).toBe(`${URL}#invite`);
      expect(link.classList.contains('lg:hidden')).toBe(true);
      expect(tokens(link.className.replace(' lg:hidden', ''))).toEqual(tokens(OUTLINE_BUTTON));
      const section = page.querySelector<HTMLElement>('#invite')!;
      const scrolled = vi.fn();
      section.scrollIntoView = scrolled;
      link.click();
      await o.flush();
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input('email'));
    });

    describe('pressed while the leagues are still loading', () => {
      const jump = () => page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;

      it('focuses Email as soon as the form appears, and scrolls only once', async () => {
        await open({ members: MEMBERS, pending: PENDING });
        expect(page.querySelector('#invite form')).toBeNull();
        const scrolled = vi.fn();
        page.querySelector<HTMLElement>('#invite')!.scrollIntoView = scrolled;
        jump().click();
        await o.flush();
        expect(scrolled).toHaveBeenCalledTimes(1);
        expect(page.querySelector('#email')).toBeNull();

        o.subscription(LIST_LEAGUES)!.emit(LEAGUES);
        await o.flush();
        expect(document.activeElement).toBe(input('email'));
        expect(scrolled).toHaveBeenCalledTimes(1);
      });

      it('keeps focus on Email when the leagues change afterwards', async () => {
        await open({ members: MEMBERS, pending: PENDING });
        page.querySelector<HTMLElement>('#invite')!.scrollIntoView = vi.fn();
        jump().click();
        o.subscription(LIST_LEAGUES)!.emit(LEAGUES);
        await o.flush();
        await type('email', 'jordan@example.com');
        o.subscription(LIST_LEAGUES)!.emit([...LEAGUES]);
        await o.flush();
        expect(document.activeElement).toBe(input('email'));
        expect(input('email').value).toBe('jordan@example.com');
      });

      it('the leagues fail: the alert shows and nothing takes focus', async () => {
        await open({ members: MEMBERS, pending: PENDING });
        page.querySelector<HTMLElement>('#invite')!.scrollIntoView = vi.fn();
        jump().click();
        await o.flush();
        o.subscription(LIST_LEAGUES)!.fail(new Error('Server Error: secret'));
        await o.flush();
        expect(text(page.querySelector('#invite [role="alert"]'))).toBe(
          'The leagues could not be loaded. Check your connection and try again.',
        );
        expect(page.querySelector('#email')).toBeNull();

        // A later successful answer renders the form: the failed press must not steal focus then.
        o.subscription(LIST_LEAGUES)!.emit(LEAGUES);
        await o.flush();
        expect(input('email')).not.toBeNull();
        expect(document.activeElement).not.toBe(input('email'));
      });

      it('drops the press when focus moved elsewhere before the form appeared', async () => {
        await open({ members: MEMBERS, pending: PENDING });
        const scrolled = vi.fn();
        page.querySelector<HTMLElement>('#invite')!.scrollIntoView = scrolled;
        jump().click();
        await o.flush();
        const elsewhere = page.querySelector<HTMLElement>('main button')!;
        expect(elsewhere.closest('#invite')).toBeNull();
        elsewhere.focus();
        expect(document.activeElement).toBe(elsewhere);

        o.subscription(LIST_LEAGUES)!.emit(LEAGUES);
        await o.flush();
        expect(input('email')).not.toBeNull();
        expect(document.activeElement).toBe(elsewhere);
      });

      it('a form that appears without a press takes no focus', async () => {
        await open({ members: MEMBERS, pending: PENDING });
        o.subscription(LIST_LEAGUES)!.emit(LEAGUES);
        await o.flush();
        expect(document.activeElement).not.toBe(input('email'));
      });
    });
  });

  describe('the form (states 1, 3, and 4)', () => {
    it('is a labelled section and form with the mockup attributes', async () => {
      await openFull();
      const section = page.querySelector('#invite')!;
      expect(section.tagName).toBe('SECTION');
      expect(section.getAttribute('aria-labelledby')).toBe('invite-heading');
      expect(text(section.querySelector('#invite-heading'))).toBe('Invite staff');
      expect(form().getAttribute('aria-labelledby')).toBe('invite-heading');
      expect(form().getAttribute('aria-describedby')).toBe('invite-note');
      expect(form().hasAttribute('novalidate')).toBe(true);
      expect(text(page.querySelector('#invite-note'))).toBe(
        'Omni League doesn’t email invites yet. You’ll get a link to send them yourself.',
      );
      expect(text(submitButton())).toBe('Create invite link');
      expect(
        tokens(submitButton().className).filter((c) => c !== 'mt-6' && c !== 'w-full'),
      ).toEqual(tokens(PRIMARY_BUTTON));
    });

    it('Email: type=email, autocomplete off, no spellcheck or capitalization, with its description', async () => {
      await openFull();
      const email = input('email');
      expect(text(page.querySelector('label[for="email"]'))).toBe('Email');
      expect(email.type).toBe('email');
      expect(email.getAttribute('autocomplete')).toBe('off');
      expect(email.getAttribute('spellcheck')).toBe('false');
      expect(email.getAttribute('autocapitalize')).toBe('none');
      expect(email.required).toBe(true);
      expect(email.getAttribute('aria-describedby')).toBe('email-description');
      expect(text(page.querySelector('#email-description'))).toBe(
        'Only an account with this email address can accept the invite.',
      );
    });

    it('Role: a fieldset with League organizer chosen first, each radio with its description', async () => {
      await openFull();
      const role = page.querySelector('fieldset#role')!;
      expect(text(role.querySelector('legend'))).toBe('Role');
      expect(input('role-organizer').checked).toBe(true);
      expect(input('role-admin').checked).toBe(false);
      expect(input('role-organizer').getAttribute('name')).toBe('role');
      expect(text(page.querySelector('label[for="role-organizer"]'))).toBe('League organizer');
      expect(text(page.querySelector('#role-organizer-description'))).toBe(
        'Runs only the leagues you choose.',
      );
      expect(text(page.querySelector('label[for="role-admin"]'))).toBe('Org admin');
      expect(text(page.querySelector('#role-admin-description'))).toBe(
        'Manages everything in Coastal Bend Rec Club, including staff.',
      );
      expect(input('role-organizer').getAttribute('aria-describedby')).toBe(
        'role-organizer-description',
      );
    });

    it('Leagues: a fieldset listing every league, drafts included, in list order', async () => {
      await openFull();
      const group = page.querySelector('fieldset#leagues')!;
      expect(text(group.querySelector('legend'))).toBe('Leagues');
      expect(text(group.querySelector('#leagues-description'))).toBe('Choose one or more.');
      const labels = [...group.querySelectorAll('label')].map((l) => text(l));
      expect(labels).toEqual(LEAGUES.map((l) => l.name));
      expect(league(1).getAttribute('role')).toBe('checkbox');
      expect(league(1).getAttribute('aria-checked')).toBe('false');
    });

    it('choosing Org admin removes the Leagues group, and League organizer brings it back with the earlier choices (state 3)', async () => {
      await openFull();
      await toggleLeague(2);
      await toggleLeague(4);
      await chooseRole('role-admin');
      expect(page.querySelector('fieldset#leagues')).toBeNull();
      expect(input('role-admin').checked).toBe(true);
      await chooseRole('role-organizer');
      expect(page.querySelector('fieldset#leagues')).not.toBeNull();
      expect(league(1).getAttribute('aria-checked')).toBe('false');
      expect(league(2).getAttribute('aria-checked')).toBe('true');
      expect(league(3).getAttribute('aria-checked')).toBe('false');
      expect(league(4).getAttribute('aria-checked')).toBe('true');
    });

    it('no leagues: League organizer is unavailable with the message under the Role group, and Org admin is chosen', async () => {
      await open({ members: MEMBERS, pending: PENDING, leagues: [] });
      const role = page.querySelector('fieldset#role')!;
      expect(input('role-organizer').disabled).toBe(true);
      expect(input('role-organizer').checked).toBe(false);
      expect(input('role-admin').checked).toBe(true);
      expect(input('role-admin').disabled).toBe(false);
      const message = role.querySelector('#role-unavailable')!;
      expect(text(message)).toBe('Create a league first to invite a league organizer.');
      expect(input('role-organizer').getAttribute('aria-describedby')).toBe(
        'role-organizer-description role-unavailable',
      );
      expect(page.querySelector('fieldset#leagues')).toBeNull();
    });

    it('no leagues: an org admin can still be invited, with no leagues', async () => {
      await open({ members: MEMBERS, pending: PENDING, leagues: [] });
      await type('email', 'boss@example.com');
      await submit();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            organizationId: COASTAL.organizationId,
            email: 'boss@example.com',
            role: 'orgAdmin',
            leagueIds: [],
          },
        ],
      ]);
    });

    it('a failed league list shows the destructive alert in place of the form', async () => {
      await open({ members: MEMBERS, pending: PENDING });
      o.subscription(LIST_LEAGUES)!.fail(new Error('Server Error: secret'));
      await o.flush();
      expect(text(page.querySelector('#invite [role="alert"]'))).toBe(
        'The leagues could not be loaded. Check your connection and try again.',
      );
      expect(page.querySelector('#invite form')).toBeNull();
    });
  });

  describe('validation (state 5)', () => {
    it('an empty email shows "Enter their email address." on Email, focuses it, and sends nothing', async () => {
      await openFull();
      await submit();
      expect(error('email')).toBe('Enter their email address.');
      expect(document.activeElement).toBe(input('email'));
      expect(input('email').getAttribute('aria-invalid')).toBe('true');
      expect(input('email').getAttribute('aria-describedby')).toBe('email-description email-error');
      expect(page.querySelector('#email-error')!.getAttribute('role')).toBe('alert');
      expect(calls()).toEqual([]);
    });

    it('a malformed email shows the format message', async () => {
      await openFull();
      for (const bad of ['dana', 'dana@', '@example.com', 'a b@example.com']) {
        await type('email', bad);
        await submit();
        expect(error('email'), bad).toBe('Enter an email address like name@example.com.');
        expect(document.activeElement).toBe(input('email'));
      }
      expect(calls()).toEqual([]);
    });

    it('a league organizer with no league shows "Choose at least one league." and focuses the first league when Email is valid', async () => {
      await openFull();
      await type('email', 'dana@example.com');
      await submit();
      expect(error('leagues')).toBe('Choose at least one league.');
      expect(document.activeElement).toBe(league(1));
      expect(error('email')).toBeNull();
      expect(calls()).toEqual([]);
    });

    it('with Email also invalid, focus goes to Email and both errors show', async () => {
      await openFull();
      await submit();
      expect(error('email')).toBe('Enter their email address.');
      expect(error('leagues')).toBe('Choose at least one league.');
      expect(document.activeElement).toBe(input('email'));
    });

    it('Org admin needs no league', async () => {
      await openFull();
      await chooseRole('role-admin');
      await type('email', 'dana@example.com');
      await submit();
      expect(error('leagues')).toBeNull();
      expect(calls()).toHaveLength(1);
    });

    it('an error clears once its field is valid', async () => {
      await openFull();
      await submit();
      await type('email', 'fine@example.com');
      expect(error('email')).toBeNull();
      await toggleLeague(1);
      expect(error('leagues')).toBeNull();
      await toggleLeague(1);
      expect(error('leagues')).toBeNull();
    });
  });

  describe('checking a field when the user leaves it', () => {
    async function leave(id: string) {
      input(id).dispatchEvent(new Event('blur'));
      await o.harness.fixture.whenStable();
    }

    async function leaveLeagues(n: number, to: HTMLElement | null) {
      league(n).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }));
      await o.harness.fixture.whenStable();
    }

    it('shows the error with aria-invalid and aria-describedby once a changed Email is left', async () => {
      await openFull();
      await type('email', 'dana');
      await leave('email');
      expect(error('email')).toBe('Enter an email address like name@example.com.');
      expect(input('email').getAttribute('aria-invalid')).toBe('true');
      expect(input('email').getAttribute('aria-describedby')).toBe('email-description email-error');
    });

    it('shows nothing while the user types an invalid partial value', async () => {
      await openFull();
      await type('email', 'dana');
      expect(error('email')).toBeNull();
      expect(input('email').hasAttribute('aria-invalid')).toBe(false);
    });

    it('shows nothing when focus passes through a field that was never changed; a submit still shows it', async () => {
      await openFull();
      await leave('email');
      await leaveLeagues(1, null);
      expect(error('email')).toBeNull();
      expect(error('leagues')).toBeNull();
      await submit();
      expect(error('email')).toBe('Enter their email address.');
      expect(error('leagues')).toBe('Choose at least one league.');
    });

    it('clears the error on the keystroke that makes the value valid', async () => {
      await openFull();
      await type('email', 'dana');
      await leave('email');
      await type('email', 'dana@example.com');
      expect(error('email')).toBeNull();
      expect(input('email').hasAttribute('aria-invalid')).toBe(false);
    });

    it('checks the leagues when focus leaves the group after a change, not while it moves within', async () => {
      await openFull();
      await toggleLeague(1);
      await toggleLeague(1);
      await leaveLeagues(1, league(2));
      expect(error('leagues')).toBeNull();
      await leaveLeagues(2, null);
      expect(error('leagues')).toBe('Choose at least one league.');
      await toggleLeague(3);
      expect(error('leagues')).toBeNull();
    });

    it('"Invite someone else" returns a form that shows nothing as focus passes through', async () => {
      await openFull();
      await createInvite();
      const another = [...page.querySelectorAll<HTMLButtonElement>('#invite button')].find((b) =>
        b.textContent?.includes('Invite someone else'),
      );
      another!.click();
      await o.flush();
      await leave('email');
      await leaveLeagues(1, null);
      expect(error('email')).toBeNull();
      expect(error('leagues')).toBeNull();
    });
  });

  describe('creating the invite (states 7 and 8)', () => {
    it('sends the organization id, the normalised email, the role, and the chosen league ids in list order; while in flight the button says so', async () => {
      await openFull();
      await type('email', '  Jordan.Mills@Example.com ');
      await toggleLeague(4);
      await toggleLeague(2);
      await submit();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            organizationId: COASTAL.organizationId,
            email: 'jordan.mills@example.com',
            role: 'leagueOrganizer',
            leagueIds: ['lg_4s', 'lg_slow'],
          },
        ],
      ]);
      expect(o.convex.calls[0].kind).toBe('action');
      expect(text(submitButton())).toBe('Creating invite link…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expect(text(page.querySelector('#invite form p[role="status"].sr-only'))).toBe(
        'Creating the invite link.',
      );
      await submit();
      expect(o.convex.calls).toHaveLength(1);
    });

    it('an org admin invite sends no leagues, whatever was checked before', async () => {
      await openFull();
      await toggleLeague(1);
      await chooseRole('role-admin');
      await type('email', 'boss@example.com');
      await submit();
      expect(calls()[0][1]).toEqual({
        organizationId: COASTAL.organizationId,
        email: 'boss@example.com',
        role: 'orgAdmin',
        leagueIds: [],
      });
    });

    it('on success the form panel becomes the link panel: heading "Invite link ready" with focus, the sentence, the note, and the whole link in a read-only text area', async () => {
      await openFull();
      await createInvite();
      expect(page.querySelector('#invite form')).toBeNull();
      const section = page.querySelector('#invite')!;
      expect(section.getAttribute('aria-labelledby')).toBe('invite-link-heading');
      expect(text(heading())).toBe('Invite link ready');
      expect(heading()!.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(heading());
      expect(text(section.querySelector('p.text-sm'))).toBe(
        'Send this link to jordan.mills@example.com yourself, by email or text. It works until Oct 25, 2026.',
      );
      expect(text(section.querySelector('strong'))).toBe('jordan.mills@example.com');
      const note = section.querySelector('[data-slot="alert"]')!;
      expect(note.getAttribute('role')).toBe('note');
      expect(text(note)).toBe(
        'This is the only time the link is shown. If it’s lost, revoke the invite and create a new one.',
      );
      expect(text(page.querySelector('label[for="invite-link"]'))).toBe('Invite link');
      expect(linkBox().readOnly).toBe(true);
      expect(linkBox().value).toBe(expectedLink());
      expect(linkBox().getAttribute('aria-describedby')).toBe('copy-status');
      expect(linkBox().getAttribute('spellcheck')).toBe('false');
      expect(text(copyButton())).toBe('Copy link');
      expect(copyButton().getAttribute('aria-describedby')).toBe('copy-status');
      expect(copyStatus().getAttribute('role')).toBe('status');
      expect(text(copyStatus())).toBe('');
    });

    it('the invite is listed as pending without a link, once the live list has it', async () => {
      await openFull();
      await createInvite();
      o.subscription(LIST_PENDING)!.emit([
        ...PENDING,
        {
          inviteId: 'inv_new',
          email: 'jordan.mills@example.com',
          role: 'leagueOrganizer',
          leagueNames: ['Wednesday Coed Slow-Pitch'],
          expiresAt: NOW + 14 * DAY,
        },
      ]);
      await o.flush();
      expect(pending()).toHaveLength(3);
      expect(text(pending()[2].querySelector('h3'))).toBe('jordan.mills@example.com');
      expect(pendingSection().querySelector('textarea, a[href*="invites"]')).toBeNull();
      expect(pendingSection().textContent).not.toContain(TOKEN);
      expect(members()).toHaveLength(3);
    });

    it('the token reaches no attribute and no text: it is only the text area’s value', async () => {
      await openFull();
      await createInvite();
      expect(page.querySelector('main')!.innerHTML).not.toContain(TOKEN);
      expect(page.querySelector('main')!.textContent).not.toContain(TOKEN);
      expect(linkBox().value).toContain(TOKEN);
    });

    it('"Invite someone else" returns the empty form with focus on Email, and the link is gone from the page', async () => {
      await openFull();
      await createInvite();
      const again = [...page.querySelectorAll<HTMLButtonElement>('#invite button')].find((b) =>
        text(b)?.includes('Invite someone else'),
      )!;
      again.click();
      await o.flush();
      expect(page.querySelector('#invite-link')).toBeNull();
      expect(page.textContent).not.toContain(TOKEN);
      expect(input('email').value).toBe('');
      expect(input('role-organizer').checked).toBe(true);
      expect(league(4).getAttribute('aria-checked')).toBe('false');
      expect(document.activeElement).toBe(input('email'));
    });

    it('a page opened afterwards shows no link or token anywhere', async () => {
      await openFull();
      await createInvite();
      TestBed.resetTestingModule();
      await openFull();
      expect(page.querySelector('textarea')).toBeNull();
      expect(page.textContent).not.toContain(TOKEN);
      expect(page.textContent).not.toContain('/invites/accept');
    });
  });

  describe('copying the link (states 9 and 10)', () => {
    function stubClipboard(writeText: unknown) {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: writeText === undefined ? undefined : { writeText },
        configurable: true,
      });
    }
    afterEach(() => stubClipboard(undefined));

    it('writes the whole link to the clipboard, the button says "Copied", and the status says "Link copied."', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard(writeText);
      await openFull();
      await createInvite();
      copyButton().focus();
      copyButton().click();
      await o.flush();
      expect(writeText).toHaveBeenCalledExactlyOnceWith(expectedLink());
      expect(text(copyButton())).toBe('Copied');
      expect(text(copyStatus())).toBe('Link copied.');
      expect(copyStatus().getAttribute('role')).toBe('status');
      expect(copyStatus().querySelector('ng-icon')).not.toBeNull();
      expect(document.activeElement).toBe(copyButton());
      expect(linkBox().value).toBe(expectedLink());
    });

    it('a rejected write shows "Couldn\'t copy. Select the link and copy it.", keeps the button text, and keeps the link visible', async () => {
      stubClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
      await openFull();
      await createInvite();
      copyButton().click();
      await o.flush();
      expect(text(copyStatus())).toBe('Couldn’t copy. Select the link and copy it.');
      expect(copyStatus().getAttribute('role')).toBe('status');
      expect(text(copyButton())).toBe('Copy link');
      expect(linkBox().value).toBe(expectedLink());
    });

    it('a missing clipboard shows the same message', async () => {
      stubClipboard(undefined);
      await openFull();
      await createInvite();
      copyButton().click();
      await o.flush();
      expect(text(copyStatus())).toBe('Couldn’t copy. Select the link and copy it.');
      expect(text(copyButton())).toBe('Copy link');
      expect(linkBox().value).toBe(expectedLink());
    });

    it('a copy that works after a blocked one replaces the message', async () => {
      const writeText = vi
        .fn()
        .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
        .mockResolvedValue(undefined);
      stubClipboard(writeText);
      await openFull();
      await createInvite();
      copyButton().click();
      await o.flush();
      copyButton().click();
      await o.flush();
      expect(text(copyStatus())).toBe('Link copied.');
      expect(text(copyButton())).toBe('Copied');
    });
  });

  describe('refusals and failures (states 6 and 7)', () => {
    it('already a member: the message under Email, focus on Email, the values kept', async () => {
      await openFull();
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'email',
          code: 'alreadyMember',
          message: INVITE_MESSAGES.alreadyMember('jordan.mills@example.com'),
        }),
      );
      await o.flush();
      expect(error('email')).toBe('jordan.mills@example.com is already on your staff.');
      expect(document.activeElement).toBe(input('email'));
      expect(input('email').getAttribute('aria-invalid')).toBe('true');
      expect(input('email').value).toBe('Jordan.Mills@Example.com');
      expect(league(4).getAttribute('aria-checked')).toBe('true');
      await type('email', 'someone.else@example.com');
      expect(error('email')).toBeNull();
    });

    it('already invited: the message names revoking first', async () => {
      await openFull();
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'email',
          code: 'alreadyInvited',
          message: INVITE_MESSAGES.alreadyInvited('jordan.mills@example.com'),
        }),
      );
      await o.flush();
      expect(error('email')).toBe(
        'jordan.mills@example.com already has a pending invite. To send a new link, revoke that invite first.',
      );
      expect(page.querySelector('textarea')).toBeNull();
    });

    it('any other failure shows the form alert and focuses it, keeping the values', async () => {
      await openFull();
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert)).toBe(
        'The invite could not be created. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      expect(input('email').value).toBe('Jordan.Mills@Example.com');
      expect(text(submitButton())).toBe('Create invite link');
    });

    describe('offline (design/mockups/88-offline-note.html states 2 and 3)', () => {
      async function goOffline() {
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        TestBed.tick();
        await o.harness.fixture.whenStable();
      }

      it('the button looks disabled but stays focusable, and a press shows the offline alert and sends nothing', async () => {
        await openFull();
        await fill();
        await goOffline();
        expect(submitButton().getAttribute('aria-disabled')).toBe('true');
        expect(submitButton().classList.contains('opacity-50')).toBe(true);
        expect(submitButton().hasAttribute('disabled')).toBe(false);
        await submit();
        expect(o.convex.calls).toEqual([]);
        const box = form().querySelector<HTMLElement>('[data-slot="alert"]')!;
        expect(text(box)).toBe(
          "You're offline. Nothing was sent. Your details are still here. Try again when you're connected.",
        );
        expect(document.activeElement).toBe(box);
        expect(input('email').value).toBe('Jordan.Mills@Example.com');
      });

      it('a refusal from the adapter at call time shows the offline alert', async () => {
        await openFull();
        await fill();
        await submit();
        o.convex.calls[0].reject(new ConvexOfflineError());
        await o.flush();
        expect(text(form().querySelector('[data-slot="alert"]'))).toBe(
          "You're offline. Nothing was sent. Your details are still here. Try again when you're connected.",
        );
      });
    });
  });

  describe('Revoke (state 11)', () => {
    const revokeButton = (n: number) => pending()[n].querySelector<HTMLButtonElement>('button')!;
    const statusBox = () => pendingSection().querySelector<HTMLElement>('[data-slot="alert"]');

    async function press(n: number) {
      revokeButton(n).click();
      await o.flush();
    }

    it('acts at once with no confirmation: one call with the invite id', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      await openFull();
      await press(0);
      expect(calls()).toEqual([[REVOKE, { inviteId: 'inv_dana' }]]);
      expect(o.convex.calls[0].kind).toBe('mutation');
      expect(confirm).not.toHaveBeenCalled();
      expect(page.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
    });

    it('on success a status above the list says the invite is revoked, and focus moves to it', async () => {
      await openFull();
      await press(0);
      o.convex.calls[0].resolve(null);
      o.subscription(LIST_PENDING)!.emit([PENDING[1]]);
      await o.flush();
      const box = statusBox()!;
      expect(box.getAttribute('role')).toBe('status');
      expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
        'Invite to dana.whitlock@example.com revoked.',
      );
      // The description is followed by Undo.
      expect(text(box.querySelector('[data-slot="alert-description"]'))).toBe(
        'Its link no longer works. You can invite this address again. Undo revoking the invite to dana.whitlock@example.com',
      );
      expect(document.activeElement).toBe(box);
      const list = pendingSection().querySelector('ul')!;
      expect(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(pending().map((li) => text(li.querySelector('h3')))).toEqual([
        'r.castillo@example.com',
      ]);
    });

    it('the status is above the empty state after the last invite is revoked', async () => {
      await open({ members: MEMBERS, pending: [PENDING[0]], leagues: LEAGUES });
      await press(0);
      o.convex.calls[0].resolve(null);
      o.subscription(LIST_PENDING)!.emit([]);
      await o.flush();
      expect(text(statusBox())).toContain('Invite to dana.whitlock@example.com revoked.');
      expect(text(pendingSection())).toContain('No pending invites');
    });

    it('the address can be invited again after it was revoked', async () => {
      await openFull();
      await press(0);
      o.convex.calls[0].resolve(null);
      o.subscription(LIST_PENDING)!.emit([PENDING[1]]);
      await o.flush();
      await type('email', 'dana.whitlock@example.com');
      await toggleLeague(4);
      await submit();
      expect(o.convex.calls[1].name).toBe(CREATE);
    });

    it('a second revoke replaces the first status', async () => {
      await openFull();
      await press(0);
      o.convex.calls[0].resolve(null);
      await o.flush();
      await press(1);
      o.convex.calls[1].resolve(null);
      await o.flush();
      expect(pendingSection().querySelectorAll('[data-slot="alert"]')).toHaveLength(1);
      expect(text(statusBox())).toContain('Invite to r.castillo@example.com revoked.');
    });

    it('a failed revoke shows the destructive alert above the list, focuses it, and keeps the invite', async () => {
      await openFull();
      await press(0);
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const box = statusBox()!;
      expect(box.getAttribute('role')).toBe('alert');
      expect(text(box)).toBe(
        'The invite could not be revoked. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(box);
      expect(pending()).toHaveLength(2);
    });

    it('a press while offline shows the offline alert and sends nothing', async () => {
      await openFull();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      expect(revokeButton(0).getAttribute('aria-disabled')).toBe('true');
      expect(revokeButton(0).hasAttribute('disabled')).toBe(false);
      await press(0);
      expect(o.convex.calls).toEqual([]);
      expect(text(statusBox())).toBe(
        "You're offline. Nothing was sent. The invite is unchanged. Try again when you're connected.",
      );
      expect(pending()).toHaveLength(2);
    });

    it('a second press while one is in flight sends nothing more', async () => {
      await openFull();
      await press(0);
      await press(0);
      expect(o.convex.calls).toHaveLength(1);
    });
  });

  describe('Undo a revoke', () => {
    const DANA = 'dana.whitlock@example.com';
    const statusBox = () => pendingSection().querySelector<HTMLElement>('[data-slot="alert"]');
    const undoButton = () =>
      [...pendingSection().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        text(b)?.startsWith('Undo'),
      );
    const revokeButton = (n: number) => pending()[n].querySelector<HTMLButtonElement>('button')!;

    /** Revokes Dana's invite and lets the live list drop it: the status now offers Undo. */
    async function revokeDana(rest: unknown[] = [PENDING[1]]) {
      await openFull();
      revokeButton(0).click();
      await o.flush();
      o.convex.calls[0].resolve(null);
      o.subscription(LIST_PENDING)!.emit(rest);
      await o.flush();
    }

    async function pressUndo() {
      undoButton()!.click();
      await o.flush();
    }

    async function goOffline() {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
    }

    it('the revoked status carries an Undo button, a helm outline button named for the invite', async () => {
      await revokeDana();
      const undo = undoButton()!;
      expect(statusBox()!.contains(undo)).toBe(true);
      expect(undo.getAttribute('type')).toBe('button');
      expect(text(undo)).toBe(`Undo revoking the invite to ${DANA}`);
      expect(undo.querySelector('.sr-only')?.textContent).toBe(` revoking the invite to ${DANA}`);
      expect(tokens(undo.className)).toEqual(expect.arrayContaining(tokens(OUTLINE_BUTTON)));
      expect(text(statusBox()!.querySelector('[data-slot="alert-description"]'))).toContain(
        'Its link no longer works. You can invite this address again.',
      );
    });

    it('a failed revoke offers no Undo', async () => {
      await openFull();
      revokeButton(0).click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(undoButton()).toBeUndefined();
    });

    it('Undo sends one mutation with the invite id and shows its pending state at once', async () => {
      await revokeDana();
      await pressUndo();
      expect(calls()[1]).toEqual([RESTORE, { inviteId: 'inv_dana' }]);
      expect(o.convex.calls[1].kind).toBe('mutation');
      const pendingUndo = undoButton()!;
      expect(text(pendingUndo)).toBe('Undoing…');
      expect(pendingUndo.getAttribute('aria-disabled')).toBe('true');
      expect(pendingUndo.hasAttribute('disabled')).toBe(false);
      // A second press while one is in flight sends nothing more.
      await pressUndo();
      expect(o.convex.calls).toHaveLength(2);
    });

    it('on success the status reads restored, the row returns, and the status takes focus', async () => {
      await revokeDana();
      await pressUndo();
      o.convex.calls[1].resolve(null);
      o.subscription(LIST_PENDING)!.emit(PENDING);
      await o.flush();
      const box = statusBox()!;
      expect(box.getAttribute('role')).toBe('status');
      expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
        `Invite to ${DANA} restored.`,
      );
      expect(text(box.querySelector('[data-slot="alert-description"]'))).toBe(
        'Its link works again.',
      );
      expect(text(box)).toBe(`Invite to ${DANA} restored. Its link works again.`);
      expect(document.activeElement).toBe(box);
      expect(undoButton()).toBeUndefined();
      expect(pending().map((li) => text(li.querySelector('h3')))).toEqual([
        DANA,
        'r.castillo@example.com',
      ]);
    });

    describe('a refusal from the server says why, keeps the invite revoked, and offers no more Undo', () => {
      const refusals: [string, unknown, string][] = [
        [
          'the 10 minutes have passed',
          { code: 'windowPassed', message: INVITE_MESSAGES.restoreWindowPassed },
          'You can undo a revoke for 10 minutes. That time has passed. Invite this address again.',
        ],
        [
          'the invite had expired',
          { code: 'expired', message: INVITE_MESSAGES.restoreExpired },
          'This invite had expired, so its link cannot work again. Invite this address again.',
        ],
        [
          'another pending invite to the address exists',
          {
            field: 'email',
            code: 'alreadyInvited',
            message: INVITE_MESSAGES.alreadyInvited(DANA),
          },
          `${DANA} already has a newer pending invite, so the old link stays revoked.`,
        ],
        [
          'the address is now a member',
          { field: 'email', code: 'alreadyMember', message: INVITE_MESSAGES.alreadyMember(DANA) },
          `${DANA} is already on your staff.`,
        ],
        [
          'a league is gone',
          { code: 'leaguesGone', message: INVITE_MESSAGES.restoreLeaguesGone },
          'A league on this invite no longer exists. Invite this address again with the leagues you want.',
        ],
      ];
      for (const [name, data, description] of refusals) {
        it(name, async () => {
          await revokeDana();
          await pressUndo();
          o.convex.calls[1].reject(new ConvexError(data as never));
          await o.flush();
          const box = statusBox()!;
          expect(box.getAttribute('role')).toBe('alert');
          expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
            `Invite to ${DANA} could not be restored.`,
          );
          expect(text(box.querySelector('[data-slot="alert-description"]'))).toBe(description);
          expect(document.activeElement).toBe(box);
          expect(undoButton()).toBeUndefined();
          expect(pending()).toHaveLength(1);
        });
      }
    });

    it('any other failure shows the destructive alert, focuses it, and offers Undo again', async () => {
      await revokeDana();
      await pressUndo();
      o.convex.calls[1].reject(new Error('Server Error: secret'));
      await o.flush();
      const box = statusBox()!;
      expect(box.getAttribute('role')).toBe('alert');
      expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
        'The invite could not be restored.',
      );
      expect(text(box.querySelector('[data-slot="alert-description"]'))).toContain(
        'Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(box);
      expect(text(undoButton())).toBe(`Undo revoking the invite to ${DANA}`);
      await pressUndo();
      expect(o.convex.calls).toHaveLength(3);
      expect(calls()[2]).toEqual([RESTORE, { inviteId: 'inv_dana' }]);
    });

    it('offline, Undo is aria-disabled and a press sends nothing and shows the offline alert', async () => {
      await revokeDana();
      await goOffline();
      expect(undoButton()!.getAttribute('aria-disabled')).toBe('true');
      expect(undoButton()!.hasAttribute('disabled')).toBe(false);
      await pressUndo();
      expect(o.convex.calls).toHaveLength(1);
      const box = statusBox()!;
      expect(box.getAttribute('role')).toBe('alert');
      expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(text(box.querySelector('[data-slot="alert-description"]'))).toContain(
        'The invite is still revoked.',
      );
      expect(document.activeElement).toBe(box);
      // Undo stays, to try again when connected.
      expect(undoButton()).toBeDefined();
    });

    it('a refusal from the adapter at call time shows the offline alert', async () => {
      await revokeDana();
      await pressUndo();
      o.convex.calls[1].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(statusBox()!.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
    });

    it('the status leaves with the next press, and Undo with it', async () => {
      await revokeDana();
      revokeButton(0).click();
      await o.flush();
      expect(undoButton()).toBeUndefined();
      expect(statusBox()).toBeNull();
      o.convex.calls[1].resolve(null);
      await o.flush();
      expect(text(statusBox())).toContain('Invite to r.castillo@example.com revoked.');
      expect(undoButton()).toBeDefined();
    });

    it('leaving the page drops the status and its Undo', async () => {
      await revokeDana();
      await o.harness.navigateByUrl('/app');
      await o.harness.navigateByUrl(URL);
      page = o.harness.routeNativeElement!;
      o.subscription(GET_ADMIN_CONTEXT)?.emit(COASTAL);
      await o.flush();
      o.subscription(LIST_PENDING)?.emit([PENDING[1]]);
      await o.flush();
      expect(pending()).toHaveLength(1);
      expect(statusBox()).toBeNull();
      expect(undoButton()).toBeUndefined();
    });
  });
});
