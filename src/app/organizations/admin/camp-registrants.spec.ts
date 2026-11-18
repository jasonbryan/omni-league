import { TestBed } from '@angular/core/testing';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { NO_REGISTRANTS_YET } from './registrants-list';
import { openAdmin, text } from './testing/admin-harness';
import {
  CAMP,
  CAMP_ROUTES,
  CAMP_URL,
  GET_CAMP,
  LIST_SESSIONS,
  session,
} from './testing/camp-harness';

const LIST_REGISTRANTS = 'campRegistrations:listForSession';

const MAYA = {
  registrationId: 'cr_maya',
  name: 'Maya R.',
  guardian: { name: 'Demo Guardian', email: 'guardian@example.test' },
  registeredAt: Date.UTC(2027, 5, 1, 18),
};
const PAT = {
  registrationId: 'cr_pat',
  name: 'Pat Player',
  registeredAt: Date.UTC(2027, 5, 3, 18),
};

describe('CampManagement registrants', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  beforeEach(async () => {
    o = await openAdmin(CAMP_ROUTES, CAMP_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_CAMP)!.emit(CAMP);
    await o.flush();
    o.subscription(LIST_SESSIONS)!.emit([
      session({ registeredCount: 2, places: 20 }),
      session({ campSessionId: 'cs_week2', name: 'Week 2', registeredCount: 0 }),
    ]);
    await o.flush();
  });

  const items = () => [...page.querySelectorAll<HTMLElement>('#sessions-list > li')];
  const toggle = (name: string) =>
    items()
      .find((li) => text(li.querySelector('h3')) === name)!
      .querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const panel = (name: string) =>
    items()
      .find((li) => text(li.querySelector('h3')) === name)!
      .querySelector<HTMLElement>('app-camp-registrants');
  const rowsOf = (name: string) =>
    [...panel(name)!.querySelectorAll<HTMLElement>('tbody tr')].map((row) => [
      text(row.querySelector('th')),
      text(row.querySelector('td')),
    ]);
  const open = async (name = 'Week 1') => {
    toggle(name).click();
    await o.flush();
  };
  const registrantsAsked = () =>
    o.convex.activeSubscriptions.filter((s) => s.name === LIST_REGISTRANTS);

  it('shows "<registered> of <places>" on every session, as a closed disclosure that asks for nothing', () => {
    expect(items().map((li) => text(li.querySelector('[data-slot="session-registered"]')))).toEqual(
      ['2 of 20 registered', '0 of 20 registered'],
    );
    expect(items().map((li) => text(li.querySelector('button[aria-expanded]')))).toEqual([
      '2 of 20 registered in Week 1',
      '0 of 20 registered in Week 2',
    ]);
    expect(toggle('Week 1').type).toBe('button');
    expect(toggle('Week 1').getAttribute('data-slot')).toBe('button');
    expect(toggle('Week 1').getAttribute('aria-expanded')).toBe('false');
    expect(toggle('Week 1').hasAttribute('aria-controls')).toBe(false);
    expect(panel('Week 1')).toBeNull();
    expect(registrantsAsked()).toEqual([]);
  });

  it('opens the session’s list, asks for that session only, and keeps focus on the button', async () => {
    toggle('Week 1').focus();
    await open();
    expect(toggle('Week 1').getAttribute('aria-expanded')).toBe('true');
    expect(toggle('Week 1').getAttribute('aria-controls')).toBe(panel('Week 1')!.parentElement!.id);
    expect(registrantsAsked().map((s) => s.args)).toEqual([{ sessionId: 'cs_week1' }]);
    expect(document.activeElement).toBe(toggle('Week 1'));
  });

  it('shows each name, the guardian’s name and email under a minor, and the date of the registration', async () => {
    await open();
    registrantsAsked()[0].emit([MAYA, PAT]);
    await o.flush();
    expect(rowsOf('Week 1')).toEqual([
      ['Maya R. Guardian: Demo Guardian, guardian@example.test', 'Jun 1, 2027'],
      ['Pat Player', 'Jun 3, 2027'],
    ]);
    const heads = [...panel('Week 1')!.querySelectorAll('thead th')].map(text);
    expect(heads).toEqual(['Name', 'Registered']);
    expect(panel('Week 1')!.querySelector('th[scope="row"]')).not.toBeNull();
    expect(text(panel('Week 1')!.querySelector('caption'))).toBe('Registrants of Week 1');
  });

  it('shows the guardian’s name alone when no email is on file', async () => {
    await open();
    registrantsAsked()[0].emit([{ ...MAYA, guardian: { name: 'Demo Guardian', email: '' } }]);
    await o.flush();
    expect(rowsOf('Week 1')[0][0]).toBe('Maya R. Guardian: Demo Guardian');
  });

  it('empty: says no one has registered yet', async () => {
    await open('Week 2');
    registrantsAsked()[0].emit([]);
    await o.flush();
    expect(text(panel('Week 2'))).toBe(NO_REGISTRANTS_YET);
    expect(NO_REGISTRANTS_YET).toBe('No one has registered yet.');
    expect(panel('Week 2')!.querySelector('table')).toBeNull();
  });

  it('loading: a skeleton row for each registration the count shows, and a polite status', async () => {
    await open();
    expect(text(panel('Week 1')!.querySelector('[role="status"]'))).toBe(
      'Loading the registrants.',
    );
    expect(panel('Week 1')!.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(panel('Week 1')!.querySelector('[role="region"]')).toBeNull();
    expectSkeletonBoxes(panel('Week 1')!, { 'rounded-md': 4 });
  });

  it('error: an alert that never carries the error message, with a Try again link to the camp page', async () => {
    await open();
    registrantsAsked()[0].fail(new Error('Server Error: secret'));
    await o.flush();
    const alert = panel('Week 1')!.querySelector('[role="alert"]')!;
    expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
      'The registrants could not be loaded.',
    );
    expect(page.textContent).not.toContain('secret');
    const retry = alert.querySelector<HTMLAnchorElement>('a')!;
    expect(text(retry)).toBe('Try again');
    expect(retry.getAttribute('href')).toBe(CAMP_URL);
  });

  it('offline with no list yet: says so instead of loading for ever', async () => {
    await open();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    TestBed.tick();
    await o.harness.fixture.whenStable();
    expect(text(panel('Week 1')!.querySelector('[role="status"]'))).toBe(
      "You're offline. The registrants will load when you’re connected.",
    );
  });

  it('closes on the second press and stops asking', async () => {
    await open();
    await open();
    expect(toggle('Week 1').getAttribute('aria-expanded')).toBe('false');
    expect(panel('Week 1')).toBeNull();
    expect(registrantsAsked()).toEqual([]);
  });

  it('keeps several sessions open at once, each asking for its own list', async () => {
    await open('Week 1');
    await open('Week 2');
    expect(registrantsAsked().map((s) => s.args)).toEqual([
      { sessionId: 'cs_week1' },
      { sessionId: 'cs_week2' },
    ]);
  });

  it('keeps Delete beside the count on a session with no registrations, ahead of its places field', () => {
    const buttons = items()[1].querySelectorAll('button');
    expect([...buttons].map((button) => text(button))).toEqual([
      '0 of 20 registered in Week 2',
      'Delete Week 2',
      'Save places for Week 2',
    ]);
  });
});
