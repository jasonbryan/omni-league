import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { LOCATION_MESSAGES } from '../../../../convex/lib/locationInput';
import { ConvexConnection } from '../../core/data/convex';
import { AdminArea } from './admin-area';
import { AdminLocations } from './admin-locations';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import {
  adminRoutes,
  COASTAL,
  COASTAL_LOCATIONS,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  ME,
  openAdmin,
  text,
} from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [{ path: 'locations', component: AdminLocations }]);
const URL = `/app/organizations/${COASTAL.slug}/locations`;
const CREATE = 'locations:create';
const UPDATE = 'locations:update';
const tokens = (value: string) => value.split(' ').sort();

describe('AdminLocations', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(rows?: unknown[]) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    if (rows) {
      o.subscription(LIST_FOR_ADMIN)!.emit(rows);
      await o.flush();
    }
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const addForm = () => page.querySelector<HTMLFormElement>('#add-location form')!;
  const addSubmit = () => addForm().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const addStatus = () => addForm().querySelector('p[role="status"].sr-only');
  const rows = () => [...page.querySelectorAll<HTMLElement>('#locations-list > app-location-row')];
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const flushNow = () => o.flush();
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function submitAdd() {
    addSubmit().click();
    await flushNow();
  }

  describe('the page (states 7 and 8)', () => {
    it('asks locations.listForAdmin with the organization id, after the context says ready', async () => {
      await open();
      expect(o.convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [ME, {}],
        [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
      ]);
    });

    it('has the organization, the h1, the sentence, and the title', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Locations');
      expect(text(main.querySelector('h1 + p'))).toBe(
        'Where your leagues play. Changes show on your public page straight away.',
      );
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Locations | Coastal Bend Rec Club | Omni League',
      );
    });

    it('loading: placeholder rows and a polite status, with the add form already there', async () => {
      await open();
      const panel = page.querySelector('section[aria-labelledby="locations-heading"]')!;
      expect(text(panel.querySelector('[role="status"]'))).toBe('Loading the locations.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(panel.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(3);
      expect(page.querySelector('#add-location form')).not.toBeNull();
    });

    it('none yet (state 7): the empty state', async () => {
      await open([]);
      const panel = page.querySelector('section[aria-labelledby="locations-heading"]')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('No locations yet');
      expect(text(panel)).toContain(
        'Add the places where your leagues play. Each one appears on your public page.',
      );
      expect(panel.querySelector('ul')).toBeNull();
      expect(panel.querySelector('[role="status"]')).toBeNull();
    });

    it('populated (state 8): a row per location with name, address, and "Edit <name>"', async () => {
      await open(COASTAL_LOCATIONS);
      expect(rows()).toHaveLength(3);
      expect(rows().map((row) => text(row.querySelector('h3')))).toEqual(
        COASTAL_LOCATIONS.map((l) => l.name),
      );
      expect(text(rows()[1].querySelector('p'))).toBe('880 Redfish Flats Ln, Rockport, TX 78382');
      const edit = rows()[1].querySelector('button')!;
      expect(edit.type).toBe('button');
      expect(text(edit)).toBe('Edit Redfish Flats Fields');
      expect(edit.querySelector('.sr-only')?.textContent).toBe(' Redfish Flats Fields');
      expect(tokens(edit.className)).toEqual(tokens(OUTLINE_BUTTON));
    });

    it('a failed list shows the destructive alert, never the error message', async () => {
      await open();
      o.subscription(LIST_FOR_ADMIN)!.fail(new Error('Server Error: secret'));
      await flushNow();
      const alert = page.querySelector(
        'section[aria-labelledby="locations-heading"] [role="alert"]',
      );
      expect(text(alert)).toBe(
        'The locations could not be loaded. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('lists a location added elsewhere at once (the list is live)', async () => {
      await open(COASTAL_LOCATIONS.slice(0, 1));
      o.subscription(LIST_FOR_ADMIN)!.emit(COASTAL_LOCATIONS);
      await flushNow();
      expect(rows()).toHaveLength(3);
    });
  });

  describe('the "Add location" jump link (phones)', () => {
    it('is hidden from 1024px, targets the form, and moves focus and scroll to it', async () => {
      await open([]);
      const link = page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      expect(text(link)).toBe('Add location');
      expect(link.getAttribute('href')).toBe(`${URL}#add-location`);
      expect(link.classList.contains('lg:hidden')).toBe(true);
      expect(tokens(link.className.replace(' lg:hidden', ''))).toEqual(tokens(OUTLINE_BUTTON));
      const section = page.querySelector<HTMLElement>('#add-location')!;
      const scrolled = vi.fn();
      section.scrollIntoView = scrolled;
      link.click();
      await flushNow();
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input('name'));
    });
  });

  describe('the add form (states 7, 9, 10, 11, 12)', () => {
    it('is a labelled section and form, with Name and Address as the mockup attributes say', async () => {
      await open([]);
      const section = page.querySelector('#add-location')!;
      expect(section.tagName).toBe('SECTION');
      expect(section.getAttribute('aria-labelledby')).toBe('add-location-heading');
      expect(text(section.querySelector('h2#add-location-heading'))).toBe('Add a location');
      expect(addForm().getAttribute('aria-labelledby')).toBe('add-location-heading');
      expect(addForm().hasAttribute('novalidate')).toBe(true);
      expect(text(page.querySelector('label[for="name"]'))).toBe('Name');
      expect(text(page.querySelector('label[for="address"]'))).toBe('Address');
      for (const id of ['name', 'address']) {
        const field = input(id);
        expect([field.type, field.required, field.getAttribute('autocomplete')]).toEqual([
          'text',
          true,
          'off',
        ]);
        expect(field.hasAttribute('maxlength')).toBe(false);
        expect(field.getAttribute('aria-describedby')).toBe(`${id}-description`);
      }
      expect(text(page.querySelector('#name-description'))).toBe(
        'For example, the park or beach. Up to 100 characters.',
      );
      expect(text(page.querySelector('#address-description'))).toBe(
        'Street, city, state, and ZIP code, so visitors can find it on a map. Up to 200 characters.',
      );
      expect(text(addSubmit())).toBe('Add location');
      expect(tokens(addSubmit().className)).toEqual(tokens(`${PRIMARY_BUTTON} mt-6 w-full`));
      expect(text(addStatus())).toBe('');
    });

    it('submitted empty (state 9): both messages, aria-invalid and describedby, focus on Name, nothing sent', async () => {
      await open([]);
      await submitAdd();
      expect(error('name')).toBe('Enter the location’s name.');
      expect(error('address')).toBe('Enter the location’s address.');
      for (const id of ['name', 'address']) {
        expect(input(id).getAttribute('aria-invalid')).toBe('true');
        expect(input(id).getAttribute('aria-describedby')).toBe(`${id}-description ${id}-error`);
        expect(page.querySelector(`#${id}-error`)?.getAttribute('role')).toBe('alert');
      }
      expect(document.activeElement).toBe(input('name'));
      expect(calls()).toEqual([]);
    });

    it('a valid name and an empty address: the address message, focus on Address', async () => {
      await open([]);
      await type('name', 'Redfish Flats Fields');
      await submitAdd();
      expect(error('name')).toBeNull();
      expect(error('address')).toBe('Enter the location’s address.');
      expect(document.activeElement).toBe(input('address'));
    });

    it('whitespace-only counts as empty', async () => {
      await open([]);
      await type('name', '   ');
      await type('address', '  \t ');
      await submitAdd();
      expect(error('name')).toBe(LOCATION_MESSAGES.nameEmpty);
      expect(error('address')).toBe(LOCATION_MESSAGES.addressEmpty);
      expect(calls()).toEqual([]);
    });

    it('101 and 201 characters get the count messages, and 100 and 200 are sent', async () => {
      await open([]);
      await type('name', 'n'.repeat(101));
      await type('address', 'a'.repeat(201));
      await submitAdd();
      expect(error('name')).toBe('Use 100 characters or fewer. This name has 101.');
      expect(error('address')).toBe('Use 200 characters or fewer. This address has 201.');
      expect(document.activeElement).toBe(input('name'));
      expect(calls()).toEqual([]);
      await type('name', ` ${'n'.repeat(100)} `);
      await type('address', ` ${'a'.repeat(200)} `);
      await submitAdd();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            organizationId: COASTAL.organizationId,
            name: 'n'.repeat(100),
            address: 'a'.repeat(200),
          },
        ],
      ]);
    });

    it('an error clears once its field is valid, and is not shown again while typing', async () => {
      await open([]);
      await submitAdd();
      await type('name', 'Redfish Flats Fields');
      expect(error('name')).toBeNull();
      expect(input('name').hasAttribute('aria-invalid')).toBe(false);
      await type('name', '');
      expect(error('name')).toBeNull();
    });

    describe('checking a field when the user leaves it', () => {
      async function leave(id: string) {
        input(id).dispatchEvent(new Event('blur'));
        await o.harness.fixture.whenStable();
      }

      it('shows the error with aria-invalid and aria-describedby once a changed field is left', async () => {
        await open([]);
        await type('name', 'n'.repeat(101));
        await leave('name');
        expect(error('name')).toBe('Use 100 characters or fewer. This name has 101.');
        expect(input('name').getAttribute('aria-invalid')).toBe('true');
        expect(input('name').getAttribute('aria-describedby')).toBe('name-description name-error');
        await type('address', 'a');
        await type('address', '');
        await leave('address');
        expect(error('address')).toBe(LOCATION_MESSAGES.addressEmpty);
      });

      it('shows nothing while the user types an invalid partial value', async () => {
        await open([]);
        await type('name', 'n'.repeat(101));
        expect(error('name')).toBeNull();
        expect(input('name').hasAttribute('aria-invalid')).toBe(false);
      });

      it('shows nothing when focus passes through a field that was never changed; a submit still shows it', async () => {
        await open([]);
        await leave('name');
        await leave('address');
        expect(error('name')).toBeNull();
        expect(error('address')).toBeNull();
        await submitAdd();
        expect(error('name')).toBe(LOCATION_MESSAGES.nameEmpty);
        expect(error('address')).toBe(LOCATION_MESSAGES.addressEmpty);
      });

      it('clears the error on the keystroke that makes the value valid', async () => {
        await open([]);
        await type('name', 'n'.repeat(101));
        await leave('name');
        await type('name', 'Redfish Flats Fields');
        expect(error('name')).toBeNull();
        expect(input('name').hasAttribute('aria-invalid')).toBe(false);
      });

      it('a form emptied after an add starts again: passing through its fields shows nothing', async () => {
        await open([]);
        await type('name', 'Redfish Flats Fields');
        await type('address', '880 Redfish Flats Ln, Rockport, TX 78382');
        await submitAdd();
        o.convex.calls[0]?.resolve({ locationId: 'loc_new' });
        await flushNow();
        expect(input('name').value).toBe('');
        await leave('name');
        await leave('address');
        expect(error('name')).toBeNull();
        expect(error('address')).toBeNull();
      });

      it('a server refusal about a field shows under it until the field changes', async () => {
        await open([]);
        await type('name', 'Redfish Flats Fields');
        await type('address', '880 Redfish Flats Ln, Rockport, TX 78382');
        await submitAdd();
        o.convex.calls[0]?.reject(
          new ConvexError({ field: 'name', code: 'nameTooLong', message: 'The server says no.' }),
        );
        await flushNow();
        expect(error('name')).toBe('The server says no.');
        await leave('name');
        expect(error('name')).toBe('The server says no.');
        await type('name', 'Redfish Flats Fields 2');
        expect(error('name')).toBeNull();
      });
    });

    it('sends the trimmed values to locations.create; while in flight the button says so (state 10)', async () => {
      await open([]);
      await type('name', '  Redfish Flats Fields ');
      await type('address', ' 880 Redfish Flats Ln, Rockport, TX 78382 ');
      await submitAdd();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            organizationId: COASTAL.organizationId,
            name: 'Redfish Flats Fields',
            address: '880 Redfish Flats Ln, Rockport, TX 78382',
          },
        ],
      ]);
      expect(text(addSubmit())).toBe('Adding location…');
      expect(addSubmit().getAttribute('aria-disabled')).toBe('true');
      expect(addSubmit().disabled).toBe(false);
      expect(text(addStatus())).toBe('Adding the location.');
      expect(input('name').value).toBe('  Redfish Flats Fields ');
      await submitAdd();
      expect(o.convex.calls).toHaveLength(1);
    });

    it('on success (state 11): "<name> added." in a status above the form, the form cleared, focus on the button', async () => {
      await open([]);
      await type('name', '  Redfish Flats Fields ');
      await type('address', '880 Redfish Flats Ln, Rockport, TX 78382');
      await submitAdd();
      o.convex.calls[0].resolve({ locationId: 'loc_new' });
      await flushNow();
      const status = addForm().querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(text(status.querySelector('[data-slot="alert-title"]'))).toBe(
        'Redfish Flats Fields added.',
      );
      expect(text(status.querySelector('[data-slot="alert-description"]'))).toBe(
        'It’s on your public page now.',
      );
      expect(
        status.compareDocumentPosition(input('name')) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(input('name').value).toBe('');
      expect(input('address').value).toBe('');
      expect(document.activeElement).toBe(addSubmit());
      expect(text(addSubmit())).toBe('Add location');
      expect(addSubmit().hasAttribute('aria-disabled')).toBe(false);
      await submitAdd();
      expect(addForm().querySelector('[data-slot="alert"][role="status"]')).toBeNull();
    });

    it('the server refusing a field the client let through shows its message there, with focus', async () => {
      await open([]);
      await type('name', 'Redfish Flats Fields');
      await type('address', '880 Redfish Flats Ln');
      await submitAdd();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'address',
          code: 'addressTooLong',
          message: 'Use 200 characters or fewer. This address has 250.',
        }),
      );
      await flushNow();
      expect(error('address')).toBe('Use 200 characters or fewer. This address has 250.');
      expect(document.activeElement).toBe(input('address'));
      expect(input('name').value).toBe('Redfish Flats Fields');
      await type('address', '880 Redfish Flats Ln, Rockport');
      expect(error('address')).toBeNull();
    });

    it.each([
      ['a network failure', new Error('Connection lost')],
      ['a ConvexError that is not about a field', new ConvexError('Not allowed')],
    ])('%s (state 12): the form alert takes focus, values stay', async (_name, failure) => {
      await open([]);
      await type('name', 'Redfish Flats Fields');
      await type('address', '880 Redfish Flats Ln');
      await submitAdd();
      o.convex.calls[0].reject(failure);
      await flushNow();
      const box = addForm().querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(box.getAttribute('role')).toBe('alert');
      expect(box.getAttribute('tabindex')).toBe('-1');
      expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
        'The location could not be saved.',
      );
      expect(text(box.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(document.activeElement).toBe(box);
      expect(input('name').value).toBe('Redfish Flats Fields');
      expect(box.textContent).not.toContain('Connection lost');
      expect(text(addSubmit())).toBe('Add location');
    });

    describe('offline', () => {
      afterEach(() => vi.restoreAllMocks());

      async function goOffline() {
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        TestBed.tick();
        await o.harness.fixture.whenStable();
      }

      it('the button looks disabled but stays focusable, and a press shows the offline alert and sends nothing', async () => {
        await open([]);
        await type('name', 'Redfish Flats Fields');
        await type('address', '880 Redfish Flats Ln');
        await goOffline();
        expect(addSubmit().getAttribute('aria-disabled')).toBe('true');
        expect(addSubmit().classList.contains('opacity-50')).toBe(true);
        expect(addSubmit().hasAttribute('disabled')).toBe(false);
        await submitAdd();
        expect(o.convex.calls).toEqual([]);
        const box = addForm().querySelector<HTMLElement>('[data-slot="alert"]')!;
        expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
          "You're offline. Nothing was sent.",
        );
        expect(text(box.querySelector('[data-slot="alert-description"]'))).toBe(
          "Your details are still here. Try again when you're connected.",
        );
        expect(document.activeElement).toBe(box);
        expect(input('name').value).toBe('Redfish Flats Fields');
      });

      it('with the site answering and the socket down, the button looks disabled, a press sends nothing, and the alert says Omni League cannot be reached', async () => {
        await open([]);
        await type('name', 'Redfish Flats Fields');
        await type('address', '880 Redfish Flats Ln');
        // Fake timers only from here: `flush` waits on a real timer.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
          o.convex.setConnected(false);
          TestBed.inject(ConvexConnection).markSiteReached();
          await vi.advanceTimersByTimeAsync(5_000);
          TestBed.tick();
          expect(addSubmit().getAttribute('aria-disabled')).toBe('true');

          addSubmit().click();
          await vi.advanceTimersByTimeAsync(0);
          TestBed.tick();

          expect(o.convex.calls).toEqual([]);
          const box = addForm().querySelector<HTMLElement>('[data-slot="alert"]')!;
          expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
            "Can't reach Omni League right now. Nothing was sent.",
          );
          expect(input('name').value).toBe('Redfish Flats Fields');
        } finally {
          vi.useRealTimers();
        }
      });

      it('validation comes first: an empty form offline shows the field errors, not the alert', async () => {
        await open([]);
        await goOffline();
        await submitAdd();
        expect(error('name')).toBe(LOCATION_MESSAGES.nameEmpty);
        expect(addForm().querySelector('[data-slot="alert"]')).toBeNull();
      });
    });
  });

  describe('editing a row (states 13 to 16)', () => {
    const editButton = (row: number) => rows()[row].querySelector<HTMLButtonElement>('button')!;
    const editForm = () => page.querySelector<HTMLFormElement>('#locations-list form')!;
    const editSave = () => editForm().querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const cancel = () => editForm().querySelector<HTMLButtonElement>('button[type="button"]')!;

    async function startEdit(row = 1) {
      editButton(row).click();
      await flushNow();
    }

    it('Edit turns the row into a form in place (state 13), with the values and focus on Name', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit();
      expect(rows()).toHaveLength(3);
      expect(rows()[1].querySelector('form')).toBe(editForm());
      expect(rows()[1].querySelector('h3')?.id).toBe('edit-heading');
      expect(text(rows()[1].querySelector('h3'))).toBe('Edit location');
      expect(editForm().getAttribute('aria-labelledby')).toBe('edit-heading');
      expect(editForm().hasAttribute('novalidate')).toBe(true);
      expect(input('edit-name').value).toBe('Redfish Flats Fields');
      expect(input('edit-address').value).toBe('880 Redfish Flats Ln, Rockport, TX 78382');
      for (const id of ['edit-name', 'edit-address']) {
        expect(input(id).getAttribute('autocomplete')).toBe('off');
        expect(input(id).required).toBe(true);
        expect(input(id).getAttribute('aria-describedby')).toBe(`${id}-description`);
      }
      expect(text(page.querySelector('label[for="edit-name"]'))).toBe('Name');
      expect(text(page.querySelector('#edit-name-description'))).toBe('Up to 100 characters.');
      expect(text(page.querySelector('#edit-address-description'))).toBe('Up to 200 characters.');
      expect(text(editSave())).toBe('Save changes');
      expect(tokens(editSave().className)).toEqual(tokens(PRIMARY_BUTTON));
      expect(text(cancel())).toBe('Cancel');
      expect(tokens(cancel().className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(document.activeElement).toBe(input('edit-name'));
      expect(text(rows()[0].querySelector('h3'))).toBe('Pelican Shoals Sand Courts');
    });

    it('Cancel restores the row, drops the changes, and returns focus to Edit', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit();
      await type('edit-name', 'Changed');
      cancel().click();
      await flushNow();
      expect(page.querySelector('#locations-list form')).toBeNull();
      expect(text(rows()[1].querySelector('h3'))).toBe('Redfish Flats Fields');
      expect(document.activeElement).toBe(editButton(1));
      expect(calls()).toEqual([]);
      await startEdit();
      expect(input('edit-name').value).toBe('Redfish Flats Fields');
    });

    it('Escape in the form cancels it and returns focus to Edit', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit(2);
      input('edit-address').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await flushNow();
      expect(page.querySelector('#locations-list form')).toBeNull();
      expect(document.activeElement).toBe(editButton(2));
    });

    it('only one row is edited at a time: Edit on another row moves the form', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit(0);
      await startEdit(2);
      expect(page.querySelectorAll('#locations-list form')).toHaveLength(1);
      expect(rows()[2].querySelector('form')).not.toBeNull();
      expect(input('edit-name').value).toBe('Tern Point Softball Complex');
    });

    it('refused edits (state 14): messages by id, focus on Name then on Address, nothing sent', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit();
      await type('edit-name', '  ');
      await type('edit-address', '');
      editSave().click();
      await flushNow();
      expect(error('edit-name')).toBe('Enter the location’s name.');
      expect(error('edit-address')).toBe('Enter the location’s address.');
      expect(input('edit-name').getAttribute('aria-describedby')).toBe(
        'edit-name-description edit-name-error',
      );
      expect(document.activeElement).toBe(input('edit-name'));
      await type('edit-name', 'n'.repeat(101));
      expect(error('edit-name')).toBe('Use 100 characters or fewer. This name has 101.');
      await type('edit-name', 'Valid');
      await type('edit-address', 'a'.repeat(201));
      editSave().click();
      await flushNow();
      expect(error('edit-address')).toBe('Use 200 characters or fewer. This address has 201.');
      expect(document.activeElement).toBe(input('edit-address'));
      expect(calls()).toEqual([]);
    });

    it('checks a field of the edit form when it is left after a change', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit();
      const leave = async (id: string) => {
        input(id).dispatchEvent(new Event('blur'));
        await o.harness.fixture.whenStable();
      };
      await leave('edit-name');
      await leave('edit-address');
      expect(error('edit-name')).toBeNull();
      await type('edit-name', '');
      expect(error('edit-name')).toBeNull();
      await leave('edit-name');
      expect(error('edit-name')).toBe(LOCATION_MESSAGES.nameEmpty);
      expect(input('edit-name').getAttribute('aria-invalid')).toBe('true');
      expect(input('edit-name').getAttribute('aria-describedby')).toBe(
        'edit-name-description edit-name-error',
      );
      await type('edit-name', 'Valid');
      expect(error('edit-name')).toBeNull();
      expect(calls()).toEqual([]);
    });

    it('saves the trimmed values to locations.update with the stored id, and says so while saving (state 15)', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit();
      await type('edit-name', ' Redfish Flats Soccer Fields ');
      editSave().click();
      await flushNow();
      expect(calls()).toEqual([
        [
          UPDATE,
          {
            locationId: 'loc_redfish',
            name: 'Redfish Flats Soccer Fields',
            address: '880 Redfish Flats Ln, Rockport, TX 78382',
          },
        ],
      ]);
      expect(text(editSave())).toBe('Saving…');
      expect(editSave().getAttribute('aria-disabled')).toBe('true');
      expect(text(editForm().querySelector('p[role="status"].sr-only'))).toBe(
        'Saving the location.',
      );
      editSave().click();
      await flushNow();
      expect(o.convex.calls).toHaveLength(1);
    });

    it('on success (state 16): the row is restored, "<name> saved." sits above the list, focus is on that row’s Edit', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit();
      await type('edit-name', 'Redfish Flats Soccer Fields');
      editSave().click();
      await flushNow();
      o.convex.calls[0].resolve(null);
      await flushNow();
      o.subscription(LIST_FOR_ADMIN)!.emit([
        COASTAL_LOCATIONS[0],
        { ...COASTAL_LOCATIONS[1], name: 'Redfish Flats Soccer Fields' },
        COASTAL_LOCATIONS[2],
      ]);
      await flushNow();
      expect(page.querySelector('#locations-list form')).toBeNull();
      const panel = page.querySelector('section[aria-labelledby="locations-heading"]')!;
      const status = panel.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(text(status.querySelector('[data-slot="alert-title"]'))).toBe(
        'Redfish Flats Soccer Fields saved.',
      );
      expect(status.querySelector('[data-slot="alert-description"]')).toBeNull();
      expect(
        status.compareDocumentPosition(page.querySelector('#locations-list')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(text(rows()[1].querySelector('h3'))).toBe('Redfish Flats Soccer Fields');
      expect(document.activeElement).toBe(editButton(1));
      expect(text(editButton(1))).toBe('Edit Redfish Flats Soccer Fields');
    });

    describe('Edit on another row while a save is in flight', () => {
      const panel = () => page.querySelector('section[aria-labelledby="locations-heading"]')!;

      async function pressOtherEditWhileSaving() {
        await open(COASTAL_LOCATIONS);
        await startEdit();
        await type('edit-name', 'Redfish Flats Soccer Fields');
        editSave().click();
        await flushNow();
        editButton(0).click();
        await flushNow();
      }

      it('is ignored: the saving form stays where it is', async () => {
        await pressOtherEditWhileSaving();
        expect(page.querySelectorAll('#locations-list form')).toHaveLength(1);
        expect(rows()[1].querySelector('form')).not.toBeNull();
        expect(rows()[0].querySelector('form')).toBeNull();
        expect(text(editSave())).toBe('Saving…');
        expect(input('edit-name').value).toBe('Redfish Flats Soccer Fields');
      });

      it('a success is reported as "<name> saved." and the pressed Edit works afterwards', async () => {
        await pressOtherEditWhileSaving();
        o.convex.calls[0].resolve(null);
        await flushNow();
        expect(page.querySelector('#locations-list form')).toBeNull();
        expect(text(panel().querySelector('[data-slot="alert-title"]'))).toBe(
          'Redfish Flats Soccer Fields saved.',
        );
        expect(document.activeElement).toBe(editButton(1));
        await startEdit(0);
        expect(rows()[0].querySelector('form')).not.toBeNull();
        expect(panel().querySelector('[data-slot="alert"]')).toBeNull();
      });

      it('a failure is reported in the form, which keeps the typed values, and the pressed Edit works afterwards', async () => {
        await pressOtherEditWhileSaving();
        o.convex.calls[0].reject(new Error('Connection lost'));
        await flushNow();
        expect(rows()[1].querySelector('form')).not.toBeNull();
        expect(text(editForm().querySelector('[data-slot="alert-title"]'))).toBe(
          'The location could not be saved.',
        );
        expect(input('edit-name').value).toBe('Redfish Flats Soccer Fields');
        expect(text(panel())).not.toContain('Fields saved.');
        await startEdit(0);
        expect(page.querySelectorAll('#locations-list form')).toHaveLength(1);
        expect(rows()[0].querySelector('form')).not.toBeNull();
      });

      it('a row that leaves the list during its save reports nothing and raises no error', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await open(COASTAL_LOCATIONS);
        await startEdit();
        editSave().click();
        await flushNow();
        o.subscription(LIST_FOR_ADMIN)!.emit([COASTAL_LOCATIONS[0], COASTAL_LOCATIONS[2]]);
        await flushNow();
        expect(rows()).toHaveLength(2);
        o.convex.calls[0].resolve(null);
        await flushNow();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
        await startEdit(0);
        expect(rows()[0].querySelector('form')).not.toBeNull();
      });
    });

    it('the saved message goes when the next edit starts', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit();
      editSave().click();
      await flushNow();
      o.convex.calls[0].resolve(null);
      await flushNow();
      const panel = page.querySelector('section[aria-labelledby="locations-heading"]')!;
      expect(panel.querySelector('[data-slot="alert"]')).not.toBeNull();
      await startEdit(0);
      expect(panel.querySelector('[data-slot="alert"]')).toBeNull();
    });

    it('a server refusal shows on the field; any other failure shows the alert in the form, and Cancel still works', async () => {
      await open(COASTAL_LOCATIONS);
      await startEdit();
      editSave().click();
      await flushNow();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'name',
          code: 'nameTooLong',
          message: 'Use 100 characters or fewer. This name has 101.',
        }),
      );
      await flushNow();
      expect(error('edit-name')).toBe('Use 100 characters or fewer. This name has 101.');
      expect(document.activeElement).toBe(input('edit-name'));
      editSave().click();
      await flushNow();
      o.convex.calls[1].reject(new Error('Connection lost'));
      await flushNow();
      const box = editForm().querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(box.getAttribute('role')).toBe('alert');
      expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
        'The location could not be saved.',
      );
      expect(document.activeElement).toBe(box);
      cancel().click();
      await flushNow();
      expect(page.querySelector('#locations-list form')).toBeNull();
    });
  });
});
