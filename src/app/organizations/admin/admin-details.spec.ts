import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { CITY_STATE_HINT } from '../../../../convex/lib/organizationInput';
import { AdminArea } from './admin-area';
import { AdminDetails } from './admin-details';
import { PRIMARY_BUTTON } from './button-classes';
import {
  adminRoutes,
  COASTAL,
  expectPageAndShellSubscriptions,
  GET_ADMIN_CONTEXT,
  openAdmin,
  text,
} from './testing/admin-harness';
import { expectStickyFooterWithFocusFix } from './testing/sticky-footer-check';

const ROUTES = adminRoutes(AdminArea, [{ path: 'details', component: AdminDetails }]);
const URL = `/app/organizations/${COASTAL.slug}/details`;
const UPDATE = 'organizations:updateDetails';
const CITY_MESSAGE = 'Use 2 to 60 characters, such as Corpus Christi, TX.';
const tokens = (value: string) => value.split(' ').sort();

describe('AdminDetails', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(cityState?: string) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit({ ...COASTAL, ...(cityState && { cityState }) });
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('form')!;
  const save = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const status = () => page.querySelector<HTMLElement>('main [data-slot="alert"][role="status"]');
  const failure = () => page.querySelector<HTMLElement>('main [data-slot="alert"][role="alert"]');
  const undo = () =>
    [...page.querySelectorAll<HTMLButtonElement>('main button')].find((b) =>
      text(b)?.startsWith('Undo'),
    );
  const srStatus = () => form().querySelector('p[role="status"].sr-only');

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function leave(id: string) {
    input(id).dispatchEvent(new Event('blur'));
    await o.harness.fixture.whenStable();
  }

  async function press(button: HTMLButtonElement) {
    button.click();
    await o.flush();
  }

  it('carries the directive that keeps a mouse press from losing the click', async () => {
    await open();
    expect(save().hasAttribute('appMousePressKeepsFocus')).toBe(true);
  });

  describe('the page', () => {
    it('has the organization, the h1, a sentence, and the title', async () => {
      await open('Corpus Christi, TX');
      const main = page.querySelector('main')!;
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Details');
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
      expect(text(main.querySelector('h1 + p'))).toBe(
        'How your organization appears to players. Changes show on your public page within a few minutes.',
      );
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Details | Coastal Bend Rec Club | Omni League',
      );
    });

    it('asks nothing beyond the admin context', async () => {
      await open();
      expectPageAndShellSubscriptions(o.convex, [[GET_ADMIN_CONTEXT, { slug: COASTAL.slug }]]);
    });

    it('shows the name read-only and the City, state with its current value and hint', async () => {
      await open('Corpus Christi, TX');
      expect(page.querySelector('label[for="name"]')?.textContent?.trim()).toBe('Name');
      expect(input('name').value).toBe('Coastal Bend Rec Club');
      expect(input('name').readOnly).toBe(true);
      expect(page.querySelector('label[for="cityState"]')?.textContent?.trim()).toBe('City, state');
      expect(input('cityState').value).toBe('Corpus Christi, TX');
      expect(input('cityState').required).toBe(false);
      expect(input('cityState').getAttribute('aria-describedby')).toBe('cityState-description');
      expect(text(page.querySelector('#cityState-description'))).toBe(CITY_STATE_HINT);
    });

    it('empty: the field is blank with its hint when the organization has none', async () => {
      await open();
      expect(input('cityState').value).toBe('');
      expect(text(page.querySelector('#cityState-description'))).toBe(CITY_STATE_HINT);
      expect(status()).toBeNull();
    });

    it('keeps Save in a footer that sticks to the bottom on phones, in a card that clips', async () => {
      await open();
      const footer = form().querySelector('[data-slot="form-footer"]')!;
      expect(tokens(footer.className)).toEqual(expect.arrayContaining(['sticky', 'bottom-0']));
      expect(footer.contains(save())).toBe(true);
      expect(tokens(save().className)).toEqual(tokens(`${PRIMARY_BUTTON} w-full`));
      expect(page.querySelector('main section')?.className).toContain('overflow-clip');
    });

    it('keeps a focused control above the sticky footer (WCAG 2.4.11)', async () => {
      await open();
      expectStickyFooterWithFocusFix(o.harness.fixture.debugElement, form());
    });
  });

  describe('validation', () => {
    beforeEach(() => open('Corpus Christi, TX'));

    it('shows the error under the field when it is left with an invalid value, with aria-invalid', async () => {
      await type('cityState', 'X');
      expect(error('cityState')).toBeNull();
      await leave('cityState');
      expect(error('cityState')).toBe(CITY_MESSAGE);
      expect(input('cityState').getAttribute('aria-invalid')).toBe('true');
      expect(input('cityState').getAttribute('aria-describedby')).toBe(
        'cityState-description cityState-error',
      );
      expect(page.querySelector('#cityState-error')?.getAttribute('role')).toBe('alert');
    });

    it('clears the error on the keystroke that makes the value valid, with the text kept', async () => {
      await type('cityState', 'X');
      await leave('cityState');
      await type('cityState', 'Austin, TX');
      expect(error('cityState')).toBeNull();
      expect(input('cityState').value).toBe('Austin, TX');
      expect(input('cityState').hasAttribute('aria-invalid')).toBe(false);
    });

    it('refuses 61 characters, and a submit with an invalid value sends nothing and focuses the field', async () => {
      await type('cityState', 'c'.repeat(61));
      await press(save());
      expect(error('cityState')).toBe(CITY_MESSAGE);
      expect(document.activeElement).toBe(input('cityState'));
      expect(o.convex.calls).toEqual([]);
    });

    it('a blank value is valid', async () => {
      await type('cityState', '   ');
      await leave('cityState');
      expect(error('cityState')).toBeNull();
    });
  });

  describe('saving', () => {
    beforeEach(() => open('Corpus Christi, TX'));

    it('sends the trimmed, collapsed value with the organization id', async () => {
      await type('cityState', '  Austin,   TX ');
      await press(save());
      expect(o.convex.calls.map((c) => [c.kind, c.name, c.args])).toEqual([
        ['mutation', UPDATE, { organizationId: COASTAL.organizationId, cityState: 'Austin, TX' }],
      ]);
    });

    it('sends null for a blank value', async () => {
      await type('cityState', '');
      await press(save());
      expect(o.convex.calls[0]?.args).toEqual({
        organizationId: COASTAL.organizationId,
        cityState: null,
      });
    });

    it('while pending: "Saving…", aria-disabled, a polite status, and a second press sends nothing', async () => {
      await type('cityState', 'Austin, TX');
      await press(save());
      expect(text(save())).toBe('Saving…');
      expect(save().getAttribute('aria-disabled')).toBe('true');
      expect(save().disabled).toBe(false);
      expect(text(srStatus())).toBe('Saving the details.');
      await press(save());
      expect(o.convex.calls).toHaveLength(1);
    });

    it('on success: "Details saved." with Undo, in a status that takes focus, and the field shows the saved value', async () => {
      await type('cityState', '  Austin,   TX ');
      await press(save());
      o.convex.calls[0]?.resolve(null);
      await o.flush();
      expect(text(status()?.querySelector('[data-slot="alert-title"]'))).toBe('Details saved.');
      expect(text(undo())).toBe('Undo saving the details');
      expect(document.activeElement).toBe(status());
      expect(input('cityState').value).toBe('Austin, TX');
      expect(text(save())).toBe('Save');
      expect(save().hasAttribute('aria-disabled')).toBe(false);
    });

    it('Undo sends the earlier value and restores it in the field', async () => {
      await type('cityState', 'Austin, TX');
      await press(save());
      o.convex.calls[0]?.resolve(null);
      await o.flush();
      await press(undo()!);
      expect(o.convex.calls[1]?.args).toEqual({
        organizationId: COASTAL.organizationId,
        cityState: 'Corpus Christi, TX',
      });
      expect(text(undo())).toBe('Undoing…');
      expect(undo()?.getAttribute('aria-disabled')).toBe('true');
      o.convex.calls[1]?.resolve(null);
      await o.flush();
      expect(input('cityState').value).toBe('Corpus Christi, TX');
      expect(text(status()?.querySelector('[data-slot="alert-title"]'))).toBe('Details restored.');
      expect(undo()).toBeUndefined();
      expect(document.activeElement).toBe(status());
    });

    it('Undo restores the value stored just before the save, even when another admin changed it after the page opened', async () => {
      o.subscription(GET_ADMIN_CONTEXT)!.emit({ ...COASTAL, cityState: 'Dallas, TX' });
      await o.flush();
      await type('cityState', 'Austin, TX');
      await press(save());
      o.convex.calls[0]?.resolve(null);
      await o.flush();
      await press(undo()!);
      expect(o.convex.calls[1]?.args).toEqual({
        organizationId: COASTAL.organizationId,
        cityState: 'Dallas, TX',
      });
    });

    it('a failed Undo keeps Undo and shows an error status with the value unchanged', async () => {
      await type('cityState', 'Austin, TX');
      await press(save());
      o.convex.calls[0]?.resolve(null);
      await o.flush();
      await press(undo()!);
      o.convex.calls[1]?.reject(new Error('boom'));
      await o.flush();
      expect(text(failure()?.querySelector('[data-slot="alert-title"]'))).toBe(
        'The change could not be undone.',
      );
      expect(input('cityState').value).toBe('Austin, TX');
      expect(undo()).toBeDefined();
    });

    it('editing the field after a save removes the status', async () => {
      await type('cityState', 'Austin, TX');
      await press(save());
      o.convex.calls[0]?.resolve(null);
      await o.flush();
      await type('cityState', 'Austin, T');
      expect(status()).toBeNull();
    });
  });

  describe('saving where none was stored', () => {
    beforeEach(() => open());

    it('Undo of the first value sends null and empties the field', async () => {
      await type('cityState', 'Austin, TX');
      await press(save());
      o.convex.calls[0]?.resolve(null);
      await o.flush();
      await press(undo()!);
      expect(o.convex.calls[1]?.args).toEqual({
        organizationId: COASTAL.organizationId,
        cityState: null,
      });
      o.convex.calls[1]?.resolve(null);
      await o.flush();
      expect(input('cityState').value).toBe('');
    });
  });

  describe('server answers', () => {
    beforeEach(() => open('Corpus Christi, TX'));

    it('a refusal shows its message under the field, keeps the input, and focuses the field', async () => {
      await type('cityState', 'Austin, TX');
      await press(save());
      o.convex.calls[0]?.reject(
        new ConvexError({
          field: 'cityState',
          code: 'cityStateInvalid',
          message: 'The server says no.',
        }),
      );
      await o.flush();
      expect(error('cityState')).toBe('The server says no.');
      expect(input('cityState').value).toBe('Austin, TX');
      expect(document.activeElement).toBe(input('cityState'));
      expect(status()).toBeNull();
      await type('cityState', 'Austin, Texas');
      expect(error('cityState')).toBeNull();
    });

    it.each([
      ['a network failure', new Error('Connection lost')],
      ['a ConvexError that is not about the field', new ConvexError('Not allowed')],
    ])('%s: an alert takes focus and the input stays', async (_name, reason) => {
      await type('cityState', 'Austin, TX');
      await press(save());
      o.convex.calls[0]?.reject(reason);
      await o.flush();
      expect(text(failure()?.querySelector('[data-slot="alert-title"]'))).toBe(
        'The details could not be saved.',
      );
      expect(text(failure()?.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(document.activeElement).toBe(failure());
      expect(input('cityState').value).toBe('Austin, TX');
      expect(failure()?.textContent).not.toContain('Connection lost');
    });
  });

  describe('offline', () => {
    beforeEach(() => open('Corpus Christi, TX'));
    afterEach(() => vi.restoreAllMocks());

    async function goOffline() {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
    }

    it('Save looks disabled but stays focusable, and pressing it sends nothing and shows the offline note', async () => {
      await goOffline();
      expect(save().getAttribute('aria-disabled')).toBe('true');
      expect(save().classList.contains('opacity-50')).toBe(true);
      expect(save().hasAttribute('disabled')).toBe(false);
      await type('cityState', 'Austin, TX');
      await press(save());
      expect(o.convex.calls).toEqual([]);
      expect(text(failure()?.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(text(failure()?.querySelector('[data-slot="alert-description"]'))).toBe(
        "Your details are still here. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(failure());
      expect(input('cityState').value).toBe('Austin, TX');
    });
  });
});
