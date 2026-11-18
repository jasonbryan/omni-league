import { TestBed } from '@angular/core/testing';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { NO_REGISTRANTS_YET } from './registrants-list';
import { openAdmin, text } from './testing/admin-harness';
import {
  CLASSES,
  GET_TRAINING,
  LIST_CLASSES,
  TRAINING,
  TRAINING_ROUTES,
  TRAINING_URL,
  trainingClass,
} from './testing/training-harness';

const LIST_REGISTRANTS = 'trainingRegistrations:listForClass';

const MAYA = {
  registrationId: 'tr_maya',
  name: 'Maya R.',
  kind: 'class',
  guardian: { name: 'Demo Guardian', email: 'guardian@example.test' },
  registeredAt: Date.UTC(2027, 0, 1, 18),
};
const PAT = {
  registrationId: 'tr_pat',
  name: 'Pat Player',
  kind: 'series',
  registeredAt: Date.UTC(2027, 0, 3, 18),
};

const FIRST = 'Tue, Jan 5, 2027';
const SECOND = 'Tue, Jan 12, 2027';
const THIRD = 'Tue, Jan 19, 2027';

describe('TrainingManagement registrants', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 10, 15, 12, 0, 0) });
    o = await openAdmin(TRAINING_ROUTES, TRAINING_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_TRAINING)!.emit(TRAINING);
    await o.flush();
    o.subscription(LIST_CLASSES)!.emit(CLASSES);
    await o.flush();
  });
  afterEach(() => vi.useRealTimers());

  const items = () => [...page.querySelectorAll<HTMLElement>('#classes-list > li')];
  const item = (date: string) =>
    items().find((li) => text(li.querySelector('[data-slot="class-date"]')) === date)!;
  const toggle = (date: string) =>
    item(date).querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const panel = (date: string) => item(date).querySelector<HTMLElement>('app-training-registrants');
  const rowsOf = (date: string) =>
    [...panel(date)!.querySelectorAll<HTMLElement>('tbody tr')].map((row) => [
      row.querySelector('th')!.firstChild!.textContent!.trim(),
      text(row.querySelector('[data-slot="registrant-kind"]')),
      text(row.querySelector('[data-slot="registrant-guardian"]')) ?? null,
      text(row.querySelector('td')),
    ]);
  const open = async (date = FIRST) => {
    toggle(date).click();
    await o.flush();
  };
  const registrantsAsked = () =>
    o.convex.activeSubscriptions.filter((s) => s.name === LIST_REGISTRANTS);

  it('shows "<registered> of <places>" on every scheduled class as a closed disclosure that asks for nothing', () => {
    expect(items().map((li) => text(li.querySelector('button[aria-expanded]')) ?? null)).toEqual([
      `0 of 12 registered in ${FIRST}`,
      `3 of 12 registered in ${SECOND}`,
      null,
    ]);
    expect(toggle(FIRST).type).toBe('button');
    expect(toggle(FIRST).getAttribute('data-slot')).toBe('button');
    expect(toggle(FIRST).getAttribute('aria-expanded')).toBe('false');
    expect(toggle(FIRST).hasAttribute('aria-controls')).toBe(false);
    expect(panel(FIRST)).toBeNull();
    expect(registrantsAsked()).toEqual([]);
  });

  it('keeps the count as plain text on a cancelled class, which has no list', () => {
    expect(text(item(THIRD).querySelector('[data-slot="class-registered"]'))).toBe(
      '0 of 12 registered',
    );
    expect(item(THIRD).querySelector('button[aria-expanded]')).toBeNull();
  });

  it('opens the class’s list, asks for that class only, and keeps focus on the button', async () => {
    toggle(SECOND).focus();
    await open(SECOND);
    expect(toggle(SECOND).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(SECOND).getAttribute('aria-controls')).toBe(panel(SECOND)!.parentElement!.id);
    expect(registrantsAsked().map((s) => s.args)).toEqual([{ trainingClassId: 'tc_2' }]);
    expect(document.activeElement).toBe(toggle(SECOND));
  });

  it('marks each registrant "Series" or "This class", with the guardian under a minor and the date of the registration', async () => {
    await open(SECOND);
    registrantsAsked()[0].emit([MAYA, PAT]);
    await o.flush();
    expect(rowsOf(SECOND)).toEqual([
      ['Maya R.', 'This class', 'Guardian: Demo Guardian, guardian@example.test', 'Jan 1, 2027'],
      ['Pat Player', 'Series', null, 'Jan 3, 2027'],
    ]);
    const heads = [...panel(SECOND)!.querySelectorAll('thead th')].map(text);
    expect(heads).toEqual(['Name', 'Registered']);
    expect(text(panel(SECOND)!.querySelector('caption'))).toBe(`Registrants of ${SECOND}`);
  });

  it('empty: says no one has registered yet', async () => {
    await open();
    registrantsAsked()[0].emit([]);
    await o.flush();
    expect(text(panel(FIRST))).toBe(NO_REGISTRANTS_YET);
    expect(panel(FIRST)!.querySelector('table')).toBeNull();
  });

  it('loading: a skeleton row for each registration the count shows, and a polite status', async () => {
    await open(SECOND);
    expect(text(panel(SECOND)!.querySelector('[role="status"]'))).toBe('Loading the registrants.');
    expect(panel(SECOND)!.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(panel(SECOND)!.querySelector('caption')).toBeNull();
    expect(panel(SECOND)!.querySelector('[role="region"]')).toBeNull();
    expectSkeletonBoxes(panel(SECOND)!, { 'rounded-md': 9 });
  });

  it('loading: a single line for a class with no registrations, the room of the empty message', async () => {
    await open(FIRST);
    expect(panel(FIRST)!.querySelector('table')).toBeNull();
    expectSkeletonBoxes(panel(FIRST)!, { 'rounded-md': 1 });
  });

  it('error: an alert that never carries the error message, with a Try again link to the training page', async () => {
    await open();
    registrantsAsked()[0].fail(new Error('Server Error: secret'));
    await o.flush();
    const alert = panel(FIRST)!.querySelector('[role="alert"]')!;
    expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
      'The registrants could not be loaded.',
    );
    expect(page.textContent).not.toContain('secret');
    const retry = alert.querySelector<HTMLAnchorElement>('a')!;
    expect(text(retry)).toBe('Try again');
    expect(retry.getAttribute('href')).toBe(TRAINING_URL);
  });

  it('offline with no list yet: says so instead of loading for ever', async () => {
    await open();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    TestBed.tick();
    await o.harness.fixture.whenStable();
    expect(text(panel(FIRST)!.querySelector('[role="status"]'))).toBe(
      "You're offline. The registrants will load when you’re connected.",
    );
  });

  it('closes on the second press and stops asking', async () => {
    await open();
    await open();
    expect(toggle(FIRST).getAttribute('aria-expanded')).toBe('false');
    expect(panel(FIRST)).toBeNull();
    expect(registrantsAsked()).toEqual([]);
  });

  it('keeps several classes open at once, each asking for its own list', async () => {
    await open(FIRST);
    await open(SECOND);
    expect(registrantsAsked().map((s) => s.args)).toEqual([
      { trainingClassId: 'tc_1' },
      { trainingClassId: 'tc_2' },
    ]);
  });

  it('puts the count ahead of Cancel on a class with no registrations, and keeps the places field after it', () => {
    expect([...item(FIRST).querySelectorAll('button')].map((button) => text(button))).toEqual([
      `0 of 12 registered in ${FIRST}`,
      `Cancel ${FIRST}`,
      `Save places for ${FIRST}`,
    ]);
  });

  it('follows the count: a class that fills elsewhere updates its button', async () => {
    o.subscription(LIST_CLASSES)!.emit([trainingClass({ registeredCount: 5 })]);
    await o.flush();
    expect(text(toggle(FIRST))).toBe(`5 of 12 registered in ${FIRST}`);
  });
});
