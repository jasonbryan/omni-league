import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { LOAD_PAGE } from '../shell/follow-link';
import { PlainTestPage } from '../shell/testing/test-pages';
import { LOAD_FILTER_OVERLAYS } from './league-filters';
import { OrganizationPage } from './organization-page';
import { SAND, sandResults } from './testing/pages';

const ORG = `/organizations/${SAND.slug}`;
const LOCATIONS = 'organizations:listPublicLocations';

/** SAND with its locations on page 2 of 2. */
const onLocationsPage2 = (results: Record<string, unknown>) => ({
  ...results,
  [LOCATIONS]: { rows: SAND.locations, page: 2, pageCount: 2, total: 6 },
});
const SPORT_VIEW = `${ORG}/sports/beach-volleyball`;

let client: FakeConvexClient;
let loadPage: ReturnType<typeof vi.fn>;

async function open(url: string): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  loadPage = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug', component: OrganizationPage },
        { path: 'organizations/:orgSlug/sports/:sport', component: OrganizationPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
      { provide: LOAD_PAGE, useValue: loadPage },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  TestBed.tick();
  return harness;
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function shown(url: string, results: Record<string, unknown>): Promise<RouterTestingHarness> {
  const harness = await open(url);
  for (const [name, value] of Object.entries(results)) subscription(name).emit(value);
  await settle(harness);
  return harness;
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const filterForm = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLFormElement>('form[aria-label="Filter leagues"]');
const count = (harness: RouterTestingHarness) =>
  filterForm(harness)?.querySelector<HTMLElement>('[role="status"]') ?? null;
const button = (harness: RouterTestingHarness, name: string) => {
  const found = [...(filterForm(harness)?.querySelectorAll('button') ?? [])].find(
    (candidate) => text(candidate) === name,
  );
  if (!found) throw new Error(`no button "${name}"`);
  return found;
};
const filtersButton = (harness: RouterTestingHarness) => {
  const found = [...(filterForm(harness)?.querySelectorAll('button') ?? [])].find((candidate) =>
    text(candidate).startsWith('Filters'),
  );
  if (!found) throw new Error('no Filters button');
  return found;
};
const url = () => TestBed.inject(Router).url;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
const popover = (id: string) => document.getElementById(id);
const checkbox = (scope: Element | null, value: string) => {
  const found = scope?.querySelector<HTMLInputElement>(`input[type="checkbox"][value="${value}"]`);
  if (!found) throw new Error(`no check box ${value}`);
  return found;
};
const within = (scope: Element | null, name: string) => {
  const found = [...(scope?.querySelectorAll<HTMLElement>('a, button') ?? [])].find(
    (candidate) => (candidate.getAttribute('aria-label') ?? text(candidate)) === name,
  );
  if (!found) throw new Error(`no control "${name}"`);
  return found;
};
const escape = () =>
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );

async function press(harness: RouterTestingHarness, control: HTMLElement): Promise<void> {
  control.focus();
  control.click();
  await vi.waitFor(() => {
    expect(control.getAttribute('aria-expanded')).toBe('true');
  });
  await settle(harness);
}

beforeEach(() => {
  localStorage.clear();
  // jsdom lays nothing out, so the CDK block scroll strategy needs a document taller than the window, and
  // window.scroll, which jsdom lacks, for its restore on close.
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => window.innerHeight * 5,
  });
  vi.spyOn(window, 'scroll').mockImplementation(() => undefined);
});

afterEach(() => {
  TestBed.resetTestingModule();
  Reflect.deleteProperty(document.documentElement, 'scrollHeight');
  vi.restoreAllMocks();
  localStorage.clear();
  const head = TestBed.inject(DOCUMENT).head;
  for (const el of head.querySelectorAll('meta, link[rel="canonical"]')) el.remove();
});

describe('the filter buttons after hydration', () => {
  it('replace the disclosure with Filters and a button per dimension that names its choice', async () => {
    const harness = await shown(
      `${ORG}?gender=coed&format=4v4`,
      sandResults({ gender: ['coed'], playersPerSide: [4] }),
    );
    expect(filterForm(harness)?.querySelector('details')).toBeNull();
    const filters = filtersButton(harness);
    expect(text(filters)).toBe('Filters 2 active');
    expect(filters.getAttribute('aria-haspopup')).toBe('dialog');
    expect(filters.getAttribute('aria-expanded')).toBe('false');
    expect(
      [...(filterForm(harness)?.querySelectorAll('button') ?? [])].slice(1).map((b) => text(b)),
    ).toEqual(['Gender: Coed', 'Format: 4v4', 'Level', 'Age group']);
    for (const dimension of [...(filterForm(harness)?.querySelectorAll('button') ?? [])].slice(1)) {
      expect(dimension.getAttribute('aria-haspopup'), text(dimension)).toBe('dialog');
    }
  });

  it('create no sheet or popover until a button is pressed', async () => {
    await shown(ORG, sandResults());
    expect(document.querySelector('app-league-filter-overlays, .cdk-overlay-pane')).toBeNull();
  });
});

describe('the phone sheet', () => {
  it('is a modal dialog named Filters with focus on Close filters, and the button says it is open', async () => {
    const harness = await shown(ORG, sandResults());
    const filters = filtersButton(harness);
    await press(harness, filters);
    const sheet = dialog();
    expect(sheet).not.toBeNull();
    const title = document.getElementById(sheet?.getAttribute('aria-labelledby') ?? '');
    expect(text(title)).toBe('Filters');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close filters');
    expect(filters.getAttribute('aria-controls')).toBe(sheet?.id);
    expect(
      [...(sheet?.querySelectorAll('fieldset legend') ?? [])].map((legend) => text(legend)),
    ).toEqual(['Gender', 'Format', 'Level', 'Age group']);
    const formats = sheet?.querySelectorAll<HTMLInputElement>('input[name="format"]') ?? [];
    expect([...formats].map((input) => input.value)).toEqual(['2v2', '4v4', '6v6']);
  });

  it('counts the draft live, and Show applies it by router navigation with focus back on Filters', async () => {
    const harness = await shown(ORG, sandResults());
    const filters = filtersButton(harness);
    await press(harness, filters);
    const sheet = dialog();
    const show = () => within(sheet, text(sheet?.querySelector('button[type="submit"]')));
    expect(text(show())).toBe('Show 7 leagues');
    checkbox(sheet, 'coed').click();
    checkbox(sheet, '4v4').click();
    await settle(harness);
    expect(text(show())).toBe('Show 2 leagues');
    expect(text(sheet?.querySelector('[role="status"]'))).toBe('2 leagues match');
    expect(url()).toBe(ORG);

    show().click();
    await settle(harness);
    expect(url()).toBe(`${ORG}?gender=coed&format=4v4`);
    expect(loadPage).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(filters);
    expect(filters.getAttribute('aria-expanded')).toBe('false');
  });

  it('discards a choice the sheet closed without, so reopening shows only the applied ones', async () => {
    const harness = await shown(`${ORG}?gender=coed`, sandResults({ gender: ['coed'] }));
    const filters = filtersButton(harness);
    await press(harness, filters);
    checkbox(dialog(), 'womens').click();
    await settle(harness);
    expect(checkbox(dialog(), 'womens').checked).toBe(true);
    within(dialog(), 'Close filters').click();
    await settle(harness);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(filters);

    await press(harness, filters);
    expect(checkbox(dialog(), 'womens').checked).toBe(false);
    expect(checkbox(dialog(), 'coed').checked).toBe(true);
    expect(url()).toBe(`${ORG}?gender=coed`);
  });

  it('Clear all removes every filter by router navigation and moves focus to the count', async () => {
    const harness = await shown(
      `${ORG}?gender=coed&format=4v4&locations=2`,
      onLocationsPage2(sandResults({ gender: ['coed'], playersPerSide: [4] })),
    );
    await press(harness, filtersButton(harness));
    const clear = within(dialog(), 'Clear all');
    expect(clear.getAttribute('href')).toBe(`${ORG}?locations=2`);
    clear.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await settle(harness);
    expect(url()).toBe(`${ORG}?locations=2`);
    expect(loadPage).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(count(harness));
  });

  it('submits the hidden locations page with the draft', async () => {
    const harness = await shown(
      `${ORG}?gender=coed&locations=2`,
      onLocationsPage2(sandResults({ gender: ['coed'] })),
    );
    await press(harness, filtersButton(harness));
    const hidden = dialog()?.querySelector<HTMLInputElement>('form input[type="hidden"]');
    expect([hidden?.name, hidden?.value]).toEqual(['locations', '2']);
    checkbox(dialog(), 'mens').click();
    await settle(harness);
    within(dialog(), 'Show 5 leagues').click();
    await settle(harness);
    expect(url()).toBe(`${ORG}?gender=coed&gender=mens&locations=2`);
  });
});

describe('a dimension popover', () => {
  it('names the popover it controls only while open, and Escape closes it with focus back on its button', async () => {
    const harness = await shown(ORG, sandResults());
    const level = button(harness, 'Level');
    expect(level.getAttribute('aria-expanded')).toBe('false');
    expect(level.getAttribute('aria-controls')).toBeNull();
    await press(harness, level);
    expect(level.getAttribute('aria-controls')).toBe('filter-level');
    const panel = popover('filter-level');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-label')).toBe('Level');
    expect(panel?.closest('.cdk-overlay-container')).not.toBeNull();
    expect(text(panel?.querySelector('legend'))).toBe('Level');

    escape();
    await settle(harness);
    expect(popover('filter-level')).toBeNull();
    expect(level.getAttribute('aria-expanded')).toBe('false');
    expect(level.getAttribute('aria-controls')).toBeNull();
    expect(document.activeElement).toBe(level);
  });

  it('starts on its first check box, and Tab past either end wraps to the other end', async () => {
    const harness = await shown(ORG, sandResults());
    await press(harness, button(harness, 'Level'));
    const panel = popover('filter-level');
    const first = panel?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const show = panel?.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(document.activeElement).toBe(first);
    const tab = (from: HTMLElement | null | undefined, shiftKey: boolean) => {
      from?.focus();
      return from?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }),
      );
    };

    expect(tab(show, false)).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(tab(first, true)).toBe(false);
    expect(document.activeElement).toBe(show);
    expect(tab(first, false)).toBe(true);
    expect(popover('filter-level')).not.toBeNull();
  });

  it('a second press of its button closes it', async () => {
    const harness = await shown(ORG, sandResults());
    const level = button(harness, 'Level');
    await press(harness, level);
    level.click();
    await settle(harness);
    expect(popover('filter-level')).toBeNull();
    expect(level.getAttribute('aria-expanded')).toBe('false');
  });

  it('Show applies the whole draft: other dimensions and locations kept, the leagues page dropped', async () => {
    const harness = await shown(
      `${ORG}?gender=coed&locations=2&leagues=2`,
      onLocationsPage2(sandResults({ gender: ['coed'], page: 2 })),
    );
    const level = button(harness, 'Level');
    await press(harness, level);
    const panel = popover('filter-level');
    checkbox(panel, 'bb').click();
    await settle(harness);
    expect(text(within(panel, 'Show 1 league'))).toBe('Show 1 league');
    within(panel, 'Show 1 league').click();
    await settle(harness);
    expect(url()).toBe(`${ORG}?gender=coed&level=bb&locations=2`);
    expect(popover('filter-level')).toBeNull();
    expect(document.activeElement).toBe(level);
  });

  it('Clear gender removes only the gender values and moves focus to the count', async () => {
    const harness = await shown(
      `${ORG}?gender=coed&format=4v4`,
      sandResults({ gender: ['coed'], playersPerSide: [4] }),
    );
    await press(harness, button(harness, 'Gender: Coed'));
    const clear = within(popover('filter-gender'), 'Clear gender');
    expect(clear.getAttribute('href')).toBe(`${ORG}?format=4v4`);
    clear.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await settle(harness);
    expect(url()).toBe(`${ORG}?format=4v4`);
    expect(popover('filter-gender')).toBeNull();
    expect(document.activeElement).toBe(count(harness));
  });

  it('discards the choices of a popover closed by opening another, so reopening it shows only the applied ones', async () => {
    const harness = await shown(`${ORG}?gender=coed`, sandResults({ gender: ['coed'] }));
    const level = button(harness, 'Level');
    await press(harness, level);
    checkbox(popover('filter-level'), 'bb').click();
    await settle(harness);
    expect(text(within(popover('filter-level'), 'Show 1 league'))).toBe('Show 1 league');

    await press(harness, button(harness, 'Gender: Coed'));
    expect(popover('filter-level')).toBeNull();
    expect(level.getAttribute('aria-expanded')).toBe('false');
    const gender = popover('filter-gender');
    expect(text(gender?.querySelector('button[type="submit"]'))).toBe('Show 4 leagues');
    expect(
      [...(gender?.querySelectorAll<HTMLInputElement>('input[type="hidden"]') ?? [])].map(
        (input) => input.name,
      ),
    ).toEqual([]);

    escape();
    await settle(harness);
    await press(harness, level);
    expect(checkbox(popover('filter-level'), 'bb').checked).toBe(false);
    expect(url()).toBe(`${ORG}?gender=coed`);
  });

  it('on the sport view, counts 6v6 as 3 and Show loads the sport view path with no page', async () => {
    const harness = await shown(`${SPORT_VIEW}?page=2`, sandResults({ page: 2 }));
    await press(harness, button(harness, 'Format'));
    const panel = popover('filter-format');
    checkbox(panel, '6v6').click();
    await settle(harness);
    within(panel, 'Show 3 leagues').click();
    await settle(harness);
    expect(url()).toBe(`${SPORT_VIEW}?format=6v6`);
  });
});

describe('a press waiting on the overlay chunk', () => {
  function holdImport(fail = false): { release: () => void; loads: () => number } {
    let release!: () => void;
    let loads = 0;
    const load = async (): Promise<typeof import('./league-filter-overlays')> => {
      loads++;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await held;
      if (fail && loads === 1) throw new Error('chunk failed to load');
      return import('./league-filter-overlays');
    };
    TestBed.configureTestingModule({
      providers: [{ provide: LOAD_FILTER_OVERLAYS, useValue: load }],
    });
    return { release: () => release(), loads: () => loads };
  }

  it('marks the pressed button busy, and Escape drops the press', async () => {
    const hold = holdImport();
    const harness = await shown(ORG, sandResults());
    const filters = filtersButton(harness);
    filters.focus();
    filters.click();
    await settle(harness);
    expect(filters.getAttribute('aria-busy')).toBe('true');
    escape();
    await settle(harness);
    expect(filters.getAttribute('aria-busy')).toBeNull();
    hold.release();
    await settle(harness);
    expect(dialog()).toBeNull();
    expect(filters.getAttribute('aria-expanded')).toBe('false');
  });

  it('drops the press when a navigation starts before the import arrives', async () => {
    const hold = holdImport();
    const harness = await shown(`${ORG}?gender=coed`, sandResults({ gender: ['coed'] }));
    const filters = filtersButton(harness);
    filters.click();
    await settle(harness);
    expect(filters.getAttribute('aria-busy')).toBe('true');
    await TestBed.inject(Router).navigateByUrl(ORG);
    await settle(harness);
    expect(filters.getAttribute('aria-busy')).toBeNull();
    hold.release();
    await settle(harness);
    expect(dialog()).toBeNull();
    expect(filters.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens nothing when the import fails, and the next press tries again', async () => {
    const hold = holdImport(true);
    const harness = await shown(ORG, sandResults());
    const level = button(harness, 'Level');
    level.click();
    await settle(harness);
    expect(level.getAttribute('aria-busy')).toBe('true');
    hold.release();
    await settle(harness);
    expect(level.getAttribute('aria-busy')).toBeNull();
    expect(popover('filter-level')).toBeNull();

    level.click();
    await settle(harness);
    hold.release();
    await vi.waitFor(() => {
      expect(popover('filter-level')).not.toBeNull();
    });
    expect(hold.loads()).toBe(2);
  });
});
