import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { CAMP_WAITLIST_MESSAGES } from '../../../../convex/lib/campWaitlist';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { NO_ONE_WAITING } from './camp-waitlist';
import { openAdmin, text } from './testing/admin-harness';
import {
  CAMP,
  CAMP_ROUTES,
  CAMP_URL,
  GET_CAMP,
  LIST_SESSIONS,
  REMOVE_SESSION,
  session,
} from './testing/camp-harness';

const LIST_WAITING = 'campWaitlist:listForSession';
const PROMOTE = 'campWaitlist:promote';

const MAYA = {
  campWaitlistEntryId: 'cw_maya',
  name: 'Maya R.',
  guardian: { name: 'Demo Guardian', email: 'guardian@example.test' },
  requestedAt: Date.UTC(2027, 5, 1, 18),
};
const PAT = {
  campWaitlistEntryId: 'cw_pat',
  name: 'Pat Player',
  requestedAt: Date.UTC(2027, 5, 3, 18),
};

describe('CampManagement waitlist', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(sessions: unknown[]) {
    o = await openAdmin(CAMP_ROUTES, CAMP_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_CAMP)!.emit(CAMP);
    await o.flush();
    o.subscription(LIST_SESSIONS)!.emit(sessions);
    await o.flush();
  }

  const FULL = session({ places: 2, registeredCount: 2, waitlistCount: 2 });
  const WEEK2 = session({ campSessionId: 'cs_week2', name: 'Week 2', registeredCount: 0 });

  const items = () => [...page.querySelectorAll<HTMLElement>('#sessions-list > li')];
  const item = (name: string) => items().find((li) => text(li.querySelector('h3')) === name)!;
  const toggle = (name = 'Week 1') =>
    item(name).querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const panel = (name = 'Week 1') => item(name).querySelector<HTMLElement>('app-camp-waitlist');
  const asked = () => o.convex.activeSubscriptions.filter((s) => s.name === LIST_WAITING);
  const promoteCalls = () => o.convex.calls.filter((call) => call.name === PROMOTE);
  const promoteButtons = (name = 'Week 1') => [
    ...panel(name)!.querySelectorAll<HTMLButtonElement>('button'),
  ];
  const rows = (name = 'Week 1') => [...panel(name)!.querySelectorAll<HTMLElement>('ol > li')];

  async function openList(name = 'Week 1') {
    toggle(name).click();
    await o.flush();
  }

  describe('the row', () => {
    beforeEach(() => open([FULL, WEEK2]));

    it('says how many wait beside the registered count, and nothing for a session with no one waiting', () => {
      expect(text(toggle('Week 1'))).toBe('2 of 2 registered (2 waiting) in Week 1');
      expect(text(toggle('Week 2'))).toBe('0 of 20 registered in Week 2');
    });

    it('keeps the registered count as its own element', () => {
      expect(text(item('Week 1').querySelector('[data-slot="session-registered"]'))).toBe(
        '2 of 2 registered',
      );
    });

    it('hides Delete while someone waits, even with no registrations', async () => {
      TestBed.resetTestingModule();
      await open([session({ registeredCount: 0, waitlistCount: 1 })]);
      expect(
        [...item('Week 1').querySelectorAll('button')].map((button) => text(button)),
      ).not.toContain('Delete Week 1');
      expect(o.convex.calls.filter((call) => call.name === REMOVE_SESSION)).toEqual([]);
    });

    it('asks for nothing until the session is opened, then asks for that session only', async () => {
      expect(asked()).toEqual([]);
      await openList();
      expect(asked().map((s) => s.args)).toEqual([{ sessionId: 'cs_week1' }]);
      expect(panel('Week 2')).toBeNull();
    });
  });

  describe('the list', () => {
    beforeEach(async () => {
      await open([FULL, WEEK2]);
      await openList();
    });

    it('shows each person in the order given, with position, guardian, and the day they joined', async () => {
      asked()[0].emit([MAYA, PAT]);
      await o.flush();
      expect(rows().map((row) => text(row))).toEqual([
        expect.stringMatching(
          /^Position 1\s*Maya R\.\s*Guardian: Demo Guardian, guardian@example\.test\s*Joined Jun 1, 2027/,
        ),
        expect.stringMatching(/^Position 2\s*Pat Player\s*Joined Jun 3, 2027/),
      ]);
      expect(text(panel()!.querySelector('h4'))).toBe('Waitlist');
    });

    it('empty: says no one is waiting', async () => {
      asked()[0].emit([]);
      await o.flush();
      expect(text(panel()!.querySelector('[data-slot="waitlist-empty"]'))).toBe(NO_ONE_WAITING);
      expect(NO_ONE_WAITING).toBe('No one is waiting.');
    });

    it('loading: a skeleton and a polite status until the list arrives', () => {
      expect(text(panel()!.querySelector('[role="status"]'))).toBe('Loading the waitlist.');
      expectSkeletonBoxes(panel()!, { 'rounded-md': 4 });
    });

    it('error: an alert that never carries the error message, with a Try again link', async () => {
      asked()[0].fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = panel()!.querySelector('[role="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The waitlist could not be loaded.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(alert.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe(CAMP_URL);
    });

    it('offline with no list yet: says so instead of loading for ever', async () => {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      expect(text(panel()!.querySelector('[role="status"]'))).toBe(
        "You're offline. The waitlist will load when you’re connected.",
      );
      vi.restoreAllMocks();
    });
  });

  describe('promoting', () => {
    const withPlace = session({ places: 3, registeredCount: 2, waitlistCount: 2 });

    async function openWith(row: unknown) {
      await open([row]);
      await openList();
      asked()[0].emit([MAYA, PAT]);
      await o.flush();
    }

    it('offers Promote on the first person only, named for a screen reader, when a place is free', async () => {
      await openWith(withPlace);
      expect(promoteButtons().map((button) => text(button))).toEqual(['Promote Maya R.']);
      expect(rows()[0].querySelector('button')).not.toBeNull();
      expect(rows()[1].querySelector('button')).toBeNull();
      expect(panel()!.querySelector('[data-slot="waitlist-note"]')).toBeNull();
    });

    it('offers no Promote when no place is free, and says how to make one', async () => {
      await openWith(FULL);
      expect(promoteButtons()).toEqual([]);
      expect(text(panel()!.querySelector('[data-slot="waitlist-note"]'))).toBe(
        CAMP_WAITLIST_MESSAGES.noFreePlace,
      );
    });

    it('acts at once, with a pending state, then says who has a place, in a status that takes focus', async () => {
      await openWith(withPlace);
      promoteButtons()[0].click();
      await o.flush();
      expect(promoteCalls().map((call) => call.args)).toEqual([{ campWaitlistEntryId: 'cw_maya' }]);
      const button = promoteButtons()[0];
      expect(text(button)).toBe('Promoting… Maya R.');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      promoteCalls()[0].resolve({ registrationId: 'cr_1' });
      asked()[0].emit([PAT]);
      await o.flush();
      const alert = panel()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(alert.getAttribute('role')).toBe('status');
      expect(text(alert)).toBe('Maya R. has a place. Registered for Week 1.');
      expect(document.activeElement).toBe(alert);
      expect(rows().map((row) => text(row))).toEqual([expect.stringMatching(/^Position 1\s*Pat/)]);
    });

    it('a second press while pending sends nothing more', async () => {
      await openWith(withPlace);
      promoteButtons()[0].click();
      promoteButtons()[0].click();
      await o.flush();
      expect(promoteCalls()).toHaveLength(1);
    });

    it('a refusal shows its message in an alert that takes focus, and keeps the row', async () => {
      await openWith(withPlace);
      promoteButtons()[0].click();
      await o.flush();
      promoteCalls()[0].reject(
        new ConvexError({ code: 'noFreePlace', message: CAMP_WAITLIST_MESSAGES.noFreePlace }),
      );
      await o.flush();
      const alert = panel()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        `Maya R. could not be given a place. ${CAMP_WAITLIST_MESSAGES.noFreePlace}`,
      );
      expect(document.activeElement).toBe(alert);
      expect(rows()).toHaveLength(2);
    });

    it('any other failure says to check the connection and never shows the server detail', async () => {
      await openWith(withPlace);
      promoteButtons()[0].click();
      await o.flush();
      promoteCalls()[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(panel()!.querySelector('[data-slot="alert"]'))).toBe(
        'Maya R. could not be given a place. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('offline: refuses with the offline alert, sends nothing, and says the person still waits', async () => {
      await openWith(withPlace);
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      const button = promoteButtons()[0];
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.classList.contains('opacity-50')).toBe(true);
      button.click();
      await o.flush();
      expect(promoteCalls()).toEqual([]);
      const alert = panel()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(text(alert)).toBe(
        "You're offline. Nothing was sent. Maya R. is still waiting. Try again when you’re connected.",
      );
      expect(document.activeElement).toBe(alert);
      vi.restoreAllMocks();
    });
  });
});
