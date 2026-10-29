import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { AdminArea } from './admin-area';
import { AdminLeagues } from './admin-leagues';
import {
  adminRoutes,
  COASTAL,
  COASTAL_LOCATIONS,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  openAdmin,
  text,
} from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [{ path: 'leagues', component: AdminLeagues }]);
const URL = `/app/organizations/${COASTAL.slug}/leagues`;
const LIST_LEAGUES = 'leagues:listForAdmin';
const LIST_CUSTOM_LEVELS = 'customLevels:listForSport';
const CREATE_LEVEL = 'customLevels:create';
const REMOVE_LEVEL = 'customLevels:remove';
const CREATE_LEAGUE = 'leagues:create';

const GOLD = { customLevelId: 'level_gold', name: 'Gold', standardLevel: 'a' };

describe('The custom level panel in the create form', () => {
  let o: Awaited<ReturnType<typeof openAdmin>>;
  let page: HTMLElement;

  afterEach(() => vi.restoreAllMocks());

  async function open() {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    o.subscription(LIST_LEAGUES)!.emit([]);
    o.subscription(LIST_FOR_ADMIN)!.emit(COASTAL_LOCATIONS.slice(0, 1));
    await o.flush();
  }

  const settle = () => o.harness.fixture.whenStable();
  const form = () => page.querySelector<HTMLFormElement>('#create-league form')!;
  const field = <T extends HTMLElement>(id: string) => page.querySelector<T>(`[id="${id}"]`)!;
  const panel = () => page.querySelector('#custom-level');
  const toggle = () =>
    page.querySelector<HTMLButtonElement>('button[aria-controls="custom-level"]')!;
  const buttonNamed = (name: string) =>
    [...form().querySelectorAll('button')].find((button) => text(button)?.startsWith(name))!;
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const levelChips = () =>
    [...page.querySelectorAll<HTMLInputElement>('fieldset#level input[type="radio"]')].map(
      (radio) => ({ label: text(radio.closest('label')), checked: radio.checked }),
    );
  const checkedLevel = () => levelChips().find((chip) => chip.checked)?.label;
  const status = () =>
    page.querySelector<HTMLElement>(
      'app-custom-level-panel [role="status"]:not(.sr-only), app-custom-level-panel [role="alert"][tabindex="-1"]',
    );
  const subscriptions = (name: string) =>
    o.convex.activeSubscriptions.filter((s) => s.name === name);

  async function choose(id: string) {
    field<HTMLInputElement>(id).checked = true;
    field<HTMLInputElement>(id).dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }

  async function type(id: string, value: string) {
    field<HTMLInputElement>(id).value = value;
    field<HTMLInputElement>(id).dispatchEvent(new Event('input'));
    await settle();
  }

  async function pick(value: string) {
    field<HTMLSelectElement>('custom-level-maps').value = value;
    field<HTMLSelectElement>('custom-level-maps').dispatchEvent(new Event('change'));
    await settle();
  }

  async function press(button: HTMLElement) {
    button.click();
    await o.flush();
  }

  async function withBeachVolleyball() {
    await open();
    await choose('sport-beachVolleyball');
    subscriptions(LIST_CUSTOM_LEVELS)[0].emit([]);
    await o.flush();
  }

  async function addGold() {
    await press(toggle());
    await type('custom-level-name', 'Gold');
    await pick('a');
    await press(buttonNamed('Add level'));
    o.convex.calls.find((call) => call.name === CREATE_LEVEL)!.resolve(GOLD.customLevelId);
    await o.flush();
    subscriptions(LIST_CUSTOM_LEVELS)[0].emit([GOLD]);
    await o.flush();
  }

  describe('opening it', () => {
    it('offers a link under Level and no panel until it is pressed', async () => {
      await withBeachVolleyball();
      expect(text(toggle())).toBe('Add a custom level');
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(panel()).toBeNull();
    });

    it('asks for the sport’s custom levels of this organization once a sport is chosen', async () => {
      await open();
      expect(subscriptions(LIST_CUSTOM_LEVELS)).toEqual([]);
      await choose('sport-beachVolleyball');
      expect(subscriptions(LIST_CUSTOM_LEVELS).map((s) => s.args)).toEqual([
        { organizationId: COASTAL.organizationId, sport: 'beachVolleyball' },
      ]);
    });

    it('shows the name, the standard level select with its placeholder, and moves focus to the name', async () => {
      await withBeachVolleyball();
      await press(toggle());
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(text(page.querySelector('label[for="custom-level-name"]'))).toBe('Custom level');
      expect(text(field('custom-level-name-description'))).toBe(
        'As your players know it, such as Gold or Social. Saved for all your beach volleyball leagues.',
      );
      expect(text(page.querySelector('label[for="custom-level-maps"]'))).toBe('Filters as');
      expect(
        [...field<HTMLSelectElement>('custom-level-maps').options].map((option) => text(option)),
      ).toEqual(['Choose a standard level', 'Rec', 'B', 'BB', 'A', 'AA', 'Open']);
      expect(text(field('custom-level-maps-description'))).toBe(
        'Players who filter for this standard level find your league.',
      );
      expect(document.activeElement).toBe(field('custom-level-name'));
    });

    it('Cancel closes it, keeps the earlier level, and returns focus to the link', async () => {
      await withBeachVolleyball();
      await choose('level-bb');
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await press(buttonNamed('Cancel'));
      expect(panel()).toBeNull();
      expect(checkedLevel()).toBe('BB');
      expect(document.activeElement).toBe(toggle());
      expect(o.convex.calls).toEqual([]);
    });
  });

  describe('Add level', () => {
    it('without a standard level shows the error under Filters as, focuses its select, and keeps the name', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await press(buttonNamed('Add level'));
      expect(error('custom-level-maps')).toBe(
        'Choose the standard level Gold matches, so players can filter for it.',
      );
      expect(field('custom-level-maps').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(field('custom-level-maps'));
      expect(field<HTMLInputElement>('custom-level-name').value).toBe('Gold');
      expect(o.convex.calls).toEqual([]);
    });

    it('with no name shows the error under the name and focuses it', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await pick('a');
      await press(buttonNamed('Add level'));
      expect(error('custom-level-name')).toBe('Enter the level’s name, such as Gold or Social.');
      expect(document.activeElement).toBe(field('custom-level-name'));
    });

    it('shows a standard level’s label as already standard, as the user leaves the name', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'bb');
      expect(error('custom-level-name')).toBeNull();
      field('custom-level-name').dispatchEvent(new Event('blur'));
      await settle();
      expect(error('custom-level-name')).toBe('BB is a standard level. Choose it above.');
    });

    it('does not submit the create form when Enter is pressed in the name', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await pick('a');
      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
      field('custom-level-name').dispatchEvent(enter);
      await o.flush();
      expect(enter.defaultPrevented).toBe(true);
      expect(o.convex.calls.map((call) => [call.name, call.args])).toEqual([
        [
          CREATE_LEVEL,
          {
            organizationId: COASTAL.organizationId,
            sport: 'beachVolleyball',
            name: 'Gold',
            standardLevel: 'a',
          },
        ],
      ]);
    });

    it('closes the panel, chooses Gold, and says what it filters as, with focus on the status', async () => {
      await withBeachVolleyball();
      await addGold();
      expect(panel()).toBeNull();
      expect(checkedLevel()).toBe('Gold');
      expect(levelChips().map((chip) => chip.label)).toEqual([
        'Rec',
        'B',
        'BB',
        'A',
        'AA',
        'Open',
        'Gold',
      ]);
      expect(text(status())).toBe('Gold added. It filters as A. Undo');
      expect(document.activeElement).toBe(status());
      expect(text(field('level-description'))).toBe(
        'Standard levels for beach volleyball. Your custom levels: Gold (filters as A).',
      );
    });

    it('shows a pending state while the level is being added', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await pick('a');
      await press(buttonNamed('Add level'));
      expect(text(buttonNamed('Adding'))).toBe('Adding…');
      expect(buttonNamed('Adding').getAttribute('aria-disabled')).toBe('true');
    });

    it('shows a server refusal under the name and keeps what was entered', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await pick('a');
      await press(buttonNamed('Add level'));
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'name',
          code: 'duplicate',
          message: 'Gold is already a custom level for beach volleyball.',
        }),
      );
      await o.flush();
      expect(error('custom-level-name')).toBe(
        'Gold is already a custom level for beach volleyball.',
      );
      expect(field<HTMLInputElement>('custom-level-name').value).toBe('Gold');
      expect(field<HTMLSelectElement>('custom-level-maps').value).toBe('a');
      expect(document.activeElement).toBe(field('custom-level-name'));
      await type('custom-level-name', 'Gold 2');
      expect(error('custom-level-name')).toBeNull();
    });

    it('shows the failed alert with its heading and keeps what was entered', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await pick('a');
      await press(buttonNamed('Add level'));
      o.convex.calls[0].reject(new Error('network'));
      await o.flush();
      expect(text(panel()!.querySelector('[data-slot="alert-title"]'))).toBe(
        'The custom level could not be added.',
      );
      expect(text(panel()!.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(field<HTMLInputElement>('custom-level-name').value).toBe('Gold');
    });

    it('offline shows the offline note, sends nothing, and keeps the input', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await pick('a');
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.flush();
      expect(buttonNamed('Add level').getAttribute('aria-disabled')).toBe('true');
      await press(buttonNamed('Add level'));
      expect(text(panel()!.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(o.convex.calls).toEqual([]);
      expect(field<HTMLInputElement>('custom-level-name').value).toBe('Gold');
    });
  });

  describe('using the level', () => {
    async function fillLeague() {
      await type('name', 'Sunday Sand');
      await choose('format-4');
    }

    it('sends the custom level id and the standard level when the league is created', async () => {
      await withBeachVolleyball();
      await addGold();
      await fillLeague();
      await press(form().querySelector<HTMLButtonElement>('button[type="submit"]')!);
      const call = o.convex.calls.find((c) => c.name === CREATE_LEAGUE)!;
      expect(call.args).toMatchObject({ level: 'a', customLevelId: 'level_gold' });
    });

    it('chooses a custom chip like any level, and a standard chip leaves it', async () => {
      await withBeachVolleyball();
      subscriptions(LIST_CUSTOM_LEVELS)[0].emit([GOLD]);
      await o.flush();
      await choose('level-custom:level_gold');
      expect(checkedLevel()).toBe('Gold');
      await choose('level-bb');
      expect(checkedLevel()).toBe('BB');
    });
  });

  describe('Undo', () => {
    it('removes the level and restores the level chosen before', async () => {
      await withBeachVolleyball();
      await choose('level-bb');
      await addGold();
      await press(buttonNamed('Undo'));
      const call = o.convex.calls.find((c) => c.name === REMOVE_LEVEL)!;
      expect(call.args).toEqual({ customLevelId: 'level_gold' });
      call.resolve(null);
      await o.flush();
      subscriptions(LIST_CUSTOM_LEVELS)[0].emit([]);
      await o.flush();
      expect(checkedLevel()).toBe('BB');
      expect(levelChips().map((chip) => chip.label)).not.toContain('Gold');
      expect(text(status())).toBe('Gold removed.');
      expect(document.activeElement).toBe(status());
    });

    it('shows the refusal in the status and keeps Gold when a league uses it', async () => {
      await withBeachVolleyball();
      await addGold();
      await press(buttonNamed('Undo'));
      o.convex.calls
        .find((c) => c.name === REMOVE_LEVEL)!
        .reject(new ConvexError({ field: 'name', code: 'inUse', message: 'A league uses Gold.' }));
      await o.flush();
      expect(text(status())).toBe('A league uses Gold.');
      expect(checkedLevel()).toBe('Gold');
    });
  });

  describe('Undo offline', () => {
    it('looks disabled, sends nothing when pressed, says so, and keeps Undo for later', async () => {
      await withBeachVolleyball();
      await addGold();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.flush();
      expect(buttonNamed('Undo').getAttribute('aria-disabled')).toBe('true');
      expect(buttonNamed('Undo').classList).toContain('opacity-50');
      await press(buttonNamed('Undo'));
      expect(o.convex.calls.map((call) => call.name)).not.toContain(REMOVE_LEVEL);
      expect(text(status())).toContain("You're offline. Nothing was removed.");
      expect(buttonNamed('Undo')).toBeTruthy();
      expect(document.activeElement).toBe(status());
    });

    it('is at least 44px on a touch screen', async () => {
      await withBeachVolleyball();
      await addGold();
      expect(buttonNamed('Undo').classList).toContain('pointer-coarse:min-h-11');
    });
  });

  describe('changing the sport', () => {
    it('still says the level was added, for its own sport, with Undo, when the sport changes during Add', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await pick('a');
      await press(buttonNamed('Add level'));
      await choose('sport-soccer');
      o.convex.calls.find((call) => call.name === CREATE_LEVEL)!.resolve(GOLD.customLevelId);
      await o.flush();
      expect(text(status())).toBe('Gold added for beach volleyball. It filters as A. Undo');
      expect(document.activeElement).toBe(status());
      expect(checkedLevel()).toBe('Rec');
      await press(buttonNamed('Undo'));
      const remove = o.convex.calls.find((call) => call.name === REMOVE_LEVEL)!;
      expect(remove.args).toEqual({ customLevelId: 'level_gold' });
      remove.resolve(null);
      await o.flush();
      expect(checkedLevel()).toBe('Rec');
    });

    it('closes an open panel and discards its input', async () => {
      await withBeachVolleyball();
      await press(toggle());
      await type('custom-level-name', 'Gold');
      await choose('sport-soccer');
      expect(panel()).toBeNull();
      await press(toggle());
      expect(field<HTMLInputElement>('custom-level-name').value).toBe('');
    });

    it('clears a chosen custom level, resets Level to Rec, and does not offer Gold for the new sport', async () => {
      await withBeachVolleyball();
      await addGold();
      await choose('sport-soccer');
      expect(checkedLevel()).toBe('Rec');
      expect(status()).toBeNull();
      const soccer = subscriptions(LIST_CUSTOM_LEVELS).find((s) =>
        JSON.stringify(s.args).includes('soccer'),
      )!;
      soccer.emit([]);
      await o.flush();
      expect(levelChips().map((chip) => chip.label)).toEqual([
        'Rec',
        'Intermediate',
        'Competitive',
      ]);
    });
  });
});
