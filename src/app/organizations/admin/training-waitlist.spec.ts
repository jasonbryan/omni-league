import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { TRAINING_WAITLIST_MESSAGES } from '../../../../convex/lib/trainingWaitlist';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { NO_ONE_WAITING_FOR_SERIES, PROMOTE_HINT } from './training-waitlist';
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
  hasPlace: true,
};
const PAT = {
  trainingWaitlistEntryId: 'tw_pat',
  name: 'Pat Player',
  requestedAt: Date.UTC(2027, 0, 3, 18),
  canPromote: false,
  hasPlace: true,
};
const SAM = {
  trainingWaitlistEntryId: 'tw_sam',
  name: 'Sam R.',
  guardian: { name: 'Demo Guardian', email: 'guardian@example.test' },
  requestedAt: Date.UTC(2027, 0, 4, 18),
  canPromote: false,
  hasPlace: false,
  classId: 'tc_2',
  classDate: '2027-02-09',
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
        expect.stringMatching(/^2\s*Pat Player\s*Series\s*Jan 3, 2027\s*Promote Pat Player$/),
      ]);
      expect(text(panel()!.querySelector('[data-slot="waitlist-count"]'))).toBe('2 waiting');
      expect(panel()!.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
        'Waitlist of Tuesday Serving Clinic',
      );
    });

    it('marks a class entry "This class", and a series entry "Series"', async () => {
      await answer([MAYA, SAM]);
      expect(rows().map((row) => text(row.querySelector('[data-slot="waiting-kind"]')))).toEqual([
        'Series',
        'This class',
      ]);
    });

    it('names the class and its day in the name cell, which stays in view beside the pinned Promote, before any guardian line', async () => {
      await answer([MAYA, SAM, { ...PAT, classId: 'tc_2', classDate: '2027-02-09' }]);
      const detail = (index: number) =>
        rows()[index].querySelector('th[scope="row"] [data-slot="waiting-detail"]');
      expect(text(detail(0))).toBe('Guardian: Demo Guardian, guardian@example.test');
      expect(text(detail(1))).toBe(
        'This class · Feb 9 · Guardian: Demo Guardian, guardian@example.test',
      );
      expect(text(detail(2))).toBe('This class · Feb 9');
      expect(text(rows()[1].querySelector('[data-slot="waiting-class"]'))).toBe(
        'This class · Feb 9',
      );
      expect(rows()[0].querySelector('[data-slot="waiting-class"]')).toBeNull();
      expect(detail(2)!.classList).toContain('block');
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
      expectSkeletonBoxes(panel()!, { 'rounded-md': 8, 'rounded-lg': 2 });
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

    it('offers Promote on every row, named for a screen reader, and dims the rows that cannot be promoted', () => {
      expect([...panel()!.querySelectorAll('tbody button')].map((b) => text(b))).toEqual([
        'Promote Maya R.',
        'Promote Pat Player',
      ]);
      expect(rows()[0].querySelector('button')!.getAttribute('aria-disabled')).toBeNull();
      expect(rows()[1].querySelector('button')!.getAttribute('aria-disabled')).toBe('true');
      expect(rows()[1].querySelector('button')!.classList).toContain('opacity-50');
    });

    it('says a class entry was registered for its class', async () => {
      await answer([{ ...SAM, canPromote: true, hasPlace: true }]);
      promoteButton().click();
      await o.flush();
      expect(promoteCalls().map((call) => call.args)).toEqual([
        { trainingWaitlistEntryId: 'tw_sam' },
      ]);
      promoteCalls()[0].resolve({ registrationId: 'tr_1' });
      await answer([]);
      expect(text(panel()!.querySelector('[data-slot="alert"]'))).toBe(
        'Sam R. has a place. Registered for Tue, Feb 9, 2027 of Tuesday Serving Clinic.',
      );
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

  describe('the reason Promote needs', () => {
    it('is on screen from the first render, the same words before and after the list answers, and describes the button', async () => {
      await open();
      const hint = () => text(panel()!.querySelector('p[aria-hidden="true"]'));
      expect(hint()).toBe(PROMOTE_HINT);
      await answer([MAYA, PAT]);
      const note = panel()!.querySelector('[data-slot="promote-hint"]')!;
      expect(text(note)).toBe(PROMOTE_HINT);
      expect(note.classList).not.toContain('sr-only');
      expect(promoteButton().getAttribute('aria-describedby')).toBe(note.id);
    });

    it('is not shown when no one waits', async () => {
      await open();
      await answer([]);
      expect(panel()!.querySelector('[data-slot="promote-hint"]')).toBeNull();
    });
  });

  describe('a row that is not the next to be given a place', () => {
    beforeEach(async () => {
      await open();
      await answer([
        { ...MAYA, canPromote: false, hasPlace: false },
        SAM,
        { ...PAT, hasPlace: true },
      ]);
    });

    const press = async (index: number) => {
      rows()[index].querySelector('button')!.click();
      await o.flush();
    };
    const alertText = () => text(panel()!.querySelector('[data-slot="alert"]'));

    it('says a series entry needs a place in every class', async () => {
      await press(0);
      expect(promoteCalls()).toEqual([]);
      expect(alertText()).toBe(
        `Maya R. could not be given a place. ${TRAINING_WAITLIST_MESSAGES.noFreePlace}`,
      );
    });

    it('says a class entry needs a place in its class', async () => {
      await press(1);
      expect(promoteCalls()).toEqual([]);
      expect(alertText()).toBe(
        `Sam R. could not be given a place. ${TRAINING_WAITLIST_MESSAGES.noFreePlaceInClass}`,
      );
    });

    it('says an account that is gone cannot be given a place, and a place already held is held', async () => {
      await answer([
        { ...MAYA, canPromote: false, skipped: 'accountGone' },
        { ...PAT, canPromote: false, skipped: 'alreadyRegistered' },
      ]);
      await press(0);
      expect(alertText()).toBe(
        `Maya R. could not be given a place. ${TRAINING_WAITLIST_MESSAGES.accountGone}`,
      );
      await press(1);
      expect(alertText()).toBe(
        `Pat Player could not be given a place. ${TRAINING_WAITLIST_MESSAGES.alreadyHolds}`,
      );
      expect(promoteCalls()).toEqual([]);
    });

    it('shows the server’s message when a stale list lets a place already held through', async () => {
      await answer([MAYA]);
      promoteButton().click();
      await o.flush();
      promoteCalls()[0].reject(
        new ConvexError({
          code: 'alreadyRegistered',
          message: 'Maya R. is already registered for this training program.',
        }),
      );
      await o.flush();
      expect(alertText()).toBe(
        'Maya R. could not be given a place. Maya R. is already registered for this training program.',
      );
    });

    it('says an entry with a place waits for the one who joined first', async () => {
      await press(2);
      expect(promoteCalls()).toEqual([]);
      expect(alertText()).toBe(
        `Pat Player could not be given a place. ${TRAINING_WAITLIST_MESSAGES.notNext}`,
      );
    });
  });

  describe('while no place is free in every class', () => {
    beforeEach(async () => {
      await open();
      await answer([{ ...MAYA, canPromote: false, hasPlace: false }, PAT]);
    });

    it('dims Promote and keeps the row as it was', () => {
      expect(promoteButton().getAttribute('aria-disabled')).toBe('true');
      expect(promoteButton().classList).toContain('opacity-50');
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
