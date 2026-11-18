import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { TRAINING_WAITLIST_MESSAGES } from '../../../../convex/lib/trainingWaitlist';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { NO_ONE_WAITING_FOR_SERIES } from './training-waitlist';
import { openAdmin, text } from './testing/admin-harness';
import {
  CLASSES,
  GET_TRAINING,
  LIST_CLASSES,
  PUBLISHED_TRAINING,
  TRAINING,
  TRAINING_ROUTES,
  TRAINING_URL,
} from './testing/training-harness';

const LIST_WAITING = 'trainingWaitlist:listForTraining';
const PROMOTE = 'trainingWaitlist:promote';

const MAYA = {
  trainingWaitlistEntryId: 'tw_maya',
  name: 'Maya R.',
  guardian: { name: 'Demo Guardian', email: 'guardian@example.test' },
  requestedAt: Date.UTC(2027, 0, 1, 18),
  canPromote: true,
};
const PAT = {
  trainingWaitlistEntryId: 'tw_pat',
  name: 'Pat Player',
  requestedAt: Date.UTC(2027, 0, 3, 18),
  canPromote: false,
};

describe('TrainingManagement waitlist', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(training: unknown = { ...PUBLISHED_TRAINING, waitlistCount: 2 }) {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 10, 15, 12, 0, 0) });
    o = await openAdmin(TRAINING_ROUTES, TRAINING_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_TRAINING)!.emit(training);
    await o.flush();
    o.subscription(LIST_CLASSES)!.emit(CLASSES);
    await o.flush();
  }
  afterEach(() => vi.useRealTimers());

  const panel = () => page.querySelector<HTMLElement>('app-training-waitlist');
  const asked = () => o.convex.activeSubscriptions.filter((s) => s.name === LIST_WAITING);
  const promoteCalls = () => o.convex.calls.filter((call) => call.name === PROMOTE);
  const rows = () => [...panel()!.querySelectorAll<HTMLElement>('tbody tr')];
  const promoteButton = () => panel()!.querySelector<HTMLButtonElement>('tbody button')!;
  const answer = async (value: unknown[]) => {
    asked()[0].emit(value);
    await o.flush();
  };

  describe('the section', () => {
    it('is on a published program with classes, with its own heading and an anchor', async () => {
      await open();
      expect(panel()).not.toBeNull();
      expect(panel()!.querySelector('section')?.id).toBe('waitlist');
      expect(text(panel()!.querySelector('h2'))).toBe('Waitlist');
      expect(asked().map((s) => s.args)).toEqual([{ trainingId: 'tr_serving' }]);
    });

    it('is left out of a draft, which no one can wait for', async () => {
      await open({ ...TRAINING, status: 'draft' });
      expect(panel()).toBeNull();
      expect(asked()).toEqual([]);
    });
  });

  describe('the list', () => {
    beforeEach(() => open());

    it('shows each person in the order given: position, name, guardian, kind, and the day they joined', async () => {
      await answer([MAYA, PAT]);
      expect(rows().map((row) => text(row))).toEqual([
        expect.stringMatching(
          /^1\s*Maya R\.\s*Guardian: Demo Guardian, guardian@example\.test\s*Series\s*Jan 1, 2027\s*Promote Maya R\./,
        ),
        expect.stringMatching(/^2\s*Pat Player\s*Series\s*Jan 3, 2027$/),
      ]);
      expect(text(panel()!.querySelector('[data-slot="waitlist-count"]'))).toBe('2 waiting');
      expect(panel()!.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
        'Waitlist of Tuesday Serving Clinic',
      );
    });

    it('keeps each name and guardian line on one line, so a row keeps its height', async () => {
      await answer([MAYA]);
      expect(rows()[0].querySelector('th')!.classList).toContain('whitespace-nowrap');
    });

    it('empty: says no one is waiting', async () => {
      await answer([]);
      expect(text(panel()!.querySelector('[data-slot="waitlist-empty"]'))).toBe(
        NO_ONE_WAITING_FOR_SERIES,
      );
      expect(panel()!.querySelector('[data-slot="waitlist-count"]')).toBeNull();
    });

    it('loading: a skeleton table of the rows that wait, and a polite status', () => {
      expect(text(panel()!.querySelector('[role="status"]'))).toBe('Loading the waitlist.');
      expect(panel()!.querySelectorAll('tbody tr')).toHaveLength(2);
      expectSkeletonBoxes(panel()!, { 'rounded-md': 8, 'rounded-lg': 1 });
    });

    it('error: an alert that never carries the error message, with a Try again link', async () => {
      asked()[0].fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = panel()!.querySelector('[role="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The waitlist could not be loaded.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(alert.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe(TRAINING_URL);
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

  describe('loading with no one waiting', () => {
    it('holds one line of room, as the empty message does', async () => {
      await open({ ...PUBLISHED_TRAINING });
      expect(panel()!.querySelectorAll('tbody')).toHaveLength(0);
      expectSkeletonBoxes(panel()!, { 'rounded-md': 1 });
    });
  });

  describe('promoting', () => {
    beforeEach(async () => {
      await open();
      await answer([MAYA, PAT]);
    });

    it('offers Promote on the first person only, named for a screen reader', () => {
      expect([...panel()!.querySelectorAll('tbody button')].map((b) => text(b))).toEqual([
        'Promote Maya R.',
      ]);
      expect(rows()[1].querySelector('button')).toBeNull();
      expect(promoteButton().getAttribute('aria-disabled')).toBeNull();
    });

    it('acts at once, with a pending state, then says who has a place, in a status that takes focus', async () => {
      promoteButton().click();
      await o.flush();
      expect(promoteCalls().map((call) => call.args)).toEqual([
        { trainingWaitlistEntryId: 'tw_maya' },
      ]);
      expect(text(promoteButton())).toBe('Promoting… Maya R.');
      expect(promoteButton().getAttribute('aria-disabled')).toBe('true');
      promoteCalls()[0].resolve({ registrationId: 'tr_1' });
      await answer([PAT]);
      const alert = panel()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(alert.getAttribute('role')).toBe('status');
      expect(text(alert)).toBe(
        'Maya R. has a place. Registered for every class of Tuesday Serving Clinic.',
      );
      expect(document.activeElement).toBe(alert);
      expect(rows().map((row) => text(row))).toEqual([expect.stringMatching(/^1\s*Pat Player/)]);
    });

    it('a second press while pending sends nothing more', async () => {
      promoteButton().click();
      promoteButton().click();
      await o.flush();
      expect(promoteCalls()).toHaveLength(1);
    });

    it('a refusal shows its message in an alert that takes focus, and keeps the row', async () => {
      promoteButton().click();
      await o.flush();
      promoteCalls()[0].reject(
        new ConvexError({ code: 'notNext', message: TRAINING_WAITLIST_MESSAGES.notNext }),
      );
      await o.flush();
      const alert = panel()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        `Maya R. could not be given a place. ${TRAINING_WAITLIST_MESSAGES.notNext}`,
      );
      expect(document.activeElement).toBe(alert);
      expect(rows()).toHaveLength(2);
    });

    it('any other failure says to check the connection and never shows the server detail', async () => {
      promoteButton().click();
      await o.flush();
      promoteCalls()[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(panel()!.querySelector('[data-slot="alert"]'))).toBe(
        'Maya R. could not be given a place. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('offline: refuses with the offline alert, sends nothing, and says the person still waits', async () => {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      expect(promoteButton().getAttribute('aria-disabled')).toBe('true');
      expect(promoteButton().classList).toContain('opacity-50');
      promoteButton().click();
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

  describe('while no place is free in every class', () => {
    beforeEach(async () => {
      await open();
      await answer([{ ...MAYA, canPromote: false }, PAT]);
    });

    it('dims Promote, describes why for a screen reader, and keeps the row as it was', () => {
      const button = promoteButton();
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.classList).toContain('opacity-50');
      const hint = panel()!.querySelector(`#${button.getAttribute('aria-describedby')}`);
      expect(text(hint)).toBe(TRAINING_WAITLIST_MESSAGES.noFreePlace);
    });

    it('pressing it sends nothing and says how to make a place, in an alert that takes focus', async () => {
      promoteButton().click();
      await o.flush();
      expect(promoteCalls()).toEqual([]);
      const alert = panel()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        `Maya R. could not be given a place. ${TRAINING_WAITLIST_MESSAGES.noFreePlace}`,
      );
      expect(document.activeElement).toBe(alert);
    });
  });
});
