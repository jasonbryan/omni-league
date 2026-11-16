import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { CAMP_SESSION_MESSAGES } from '../../../../convex/lib/campSessionInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { OUTLINE_BUTTON } from './button-classes';
import { openAdmin, text } from './testing/admin-harness';
import {
  CAMP,
  CAMP_ROUTES,
  CAMP_URL,
  GET_CAMP,
  LIST_SESSIONS,
  UPDATE_PLACES,
  session,
} from './testing/camp-harness';

const tokens = (value: string) => value.split(' ').sort();

const FULL = session({ registeredCount: 20 });

describe('PlacesEditor in a camp session row', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(sessions: unknown[] = [FULL]) {
    o = await openAdmin(CAMP_ROUTES, CAMP_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_CAMP)!.emit(CAMP);
    await o.flush();
    o.subscription(LIST_SESSIONS)!.emit(sessions);
    await o.flush();
  }

  const editor = (name = 'Week 1') =>
    [...page.querySelectorAll<HTMLElement>('#sessions-list > li')]
      .find((li) => text(li.querySelector('h3')) === name)!
      .querySelector<HTMLElement>('app-places-editor')!;
  const input = (name?: string) => editor(name).querySelector<HTMLInputElement>('input')!;
  const saveButton = (name?: string) =>
    editor(name).querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const status = (name?: string) =>
    editor(name).querySelector<HTMLElement>('[data-slot="places-status"]')!;
  const error = (name?: string) => text(editor(name).querySelector('[data-slot="field-error"]'));
  const undoButton = (name?: string) =>
    [...status(name).querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => text(b) === 'Undo',
    )!;

  async function type(value: string, name?: string) {
    const element = input(name);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function leave(name?: string) {
    input(name).dispatchEvent(new Event('blur'));
    await o.harness.fixture.whenStable();
  }

  async function save(value: string, name?: string) {
    await type(value, name);
    saveButton(name).focus();
    saveButton(name).click();
    await o.flush();
  }

  async function saved(value = '22') {
    await save(value);
    o.convex.calls[0].resolve({ previousPlaces: 20 });
    o.subscription(LIST_SESSIONS)!.emit([session({ registeredCount: 20, places: Number(value) })]);
    await o.flush();
  }

  describe('the field', () => {
    it('is a numeric text field labelled with the session, holding its places', async () => {
      await open();
      const label = editor().querySelector('label')!;
      expect(text(label)).toBe('Places for Week 1');
      expect(label.getAttribute('for')).toBe(input().id);
      expect(input().getAttribute('inputmode')).toBe('numeric');
      expect(input().value).toBe('20');
    });

    it('says the range, from the registered count up to 500', async () => {
      await open([FULL, session({ campSessionId: 'cs_week2', name: 'Week 2' })]);
      expect(text(editor().querySelector('[data-slot="field-description"]'))).toBe(
        'From 20 to 500.',
      );
      expect(text(editor('Week 2').querySelector('[data-slot="field-description"]'))).toBe(
        'From 1 to 500.',
      );
      expect(input().getAttribute('aria-describedby')).toBe(
        editor().querySelector('[data-slot="field-description"]')!.id,
      );
    });

    it('has a Save places button for the session, as an outline button', async () => {
      await open();
      expect(text(saveButton())).toBe('Save places for Week 1');
      expect(saveButton().getAttribute('data-slot')).toBe('button');
      expect(tokens(saveButton().className)).toEqual(tokens(OUTLINE_BUTTON));
    });

    it('follows the places the server answers while the user has not typed', async () => {
      await open();
      o.subscription(LIST_SESSIONS)!.emit([session({ registeredCount: 20, places: 25 })]);
      await o.flush();
      expect(input().value).toBe('25');
    });

    it('keeps what the user typed when the places change underneath', async () => {
      await open();
      await type('30');
      o.subscription(LIST_SESSIONS)!.emit([session({ registeredCount: 20, places: 25 })]);
      await o.flush();
      expect(input().value).toBe('30');
    });
  });

  describe('checking on leaving the field', () => {
    it('shows places below the registered count under the field with the shared message, and keeps the text', async () => {
      await open();
      await type('19');
      expect(error()).toBeUndefined();
      await leave();
      expect(error()).toBe(CAMP_SESSION_MESSAGES.placesBelowRegistered(20));
      expect(input().getAttribute('aria-invalid')).toBe('true');
      expect(input().getAttribute('aria-describedby')).toContain(
        editor().querySelector('[data-slot="field-error"]')!.id,
      );
      expect(input().value).toBe('19');
    });

    it('clears the error as soon as the places are enough', async () => {
      await open();
      await type('19');
      await leave();
      await type('20');
      expect(error()).toBeUndefined();
      expect(input().getAttribute('aria-invalid')).toBeNull();
    });

    it('shows places outside the range, and words that are not a number', async () => {
      await open();
      for (const entry of ['501', '0', 'abc', '2.5', '']) {
        await type(entry);
        await leave();
        expect(error(), entry).toMatch(/^Enter /);
      }
    });

    it('shows no error for places the user has not changed', async () => {
      await open();
      await leave();
      expect(error()).toBeUndefined();
    });

    it('a Save with places below the registered count sends nothing, shows the error, and focuses the field', async () => {
      await open();
      await save('19');
      expect(o.convex.calls).toEqual([]);
      expect(error()).toBe(CAMP_SESSION_MESSAGES.placesBelowRegistered(20));
      expect(document.activeElement).toBe(input());
    });
  });

  describe('saving', () => {
    it('sends the session and the places, and shows Saving… with the button aria-disabled while it waits', async () => {
      await open();
      await save('22');
      expect(o.convex.calls.map((c) => [c.name, c.args])).toEqual([
        [UPDATE_PLACES, { campSessionId: 'cs_week1', places: 22 }],
      ]);
      expect(text(saveButton())).toBe('Saving…');
      expect(saveButton().getAttribute('aria-disabled')).toBe('true');
      saveButton().click();
      await o.flush();
      expect(o.convex.calls).toHaveLength(1);
    });

    it('trims the text, so " 22 " is 22', async () => {
      await open();
      await save(' 22 ');
      expect(o.convex.calls[0].args).toEqual({ campSessionId: 'cs_week1', places: 22 });
    });

    it('says "Places saved." with Undo, and leaves focus on the Save button, which is still there', async () => {
      await open();
      await saved();
      expect(text(status())).toBe('Places saved.Undo');
      expect(text(saveButton())).toBe('Save places for Week 1');
      expect(document.activeElement).toBe(saveButton());
      expect(input().value).toBe('22');
    });

    it('keeps the status in a region that is in the page before it has anything to say', async () => {
      await open();
      expect(status().getAttribute('role')).toBe('status');
      expect(text(status())).toBe('');
    });

    it('clears the status when the user edits the field again', async () => {
      await open();
      await saved();
      await type('23');
      expect(text(status())).toBe('');
    });

    it('is one row’s status: another row says nothing', async () => {
      await open([FULL, session({ campSessionId: 'cs_week2', name: 'Week 2' })]);
      await save('22');
      o.convex.calls[0].resolve({ previousPlaces: 20 });
      await o.flush();
      expect(text(status())).toBe('Places saved.Undo');
      expect(text(status('Week 2'))).toBe('');
    });
  });

  describe('Undo', () => {
    it('sends the places the server said it replaced, and says "Places restored." with focus on the status', async () => {
      await open();
      await saved();
      undoButton().click();
      await o.flush();
      expect(o.convex.calls[1].args).toEqual({ campSessionId: 'cs_week1', places: 20 });
      expect(text(status().querySelector('button'))).toBe('Undoing…');
      o.convex.calls[1].resolve({ previousPlaces: 22 });
      o.subscription(LIST_SESSIONS)!.emit([session({ registeredCount: 20, places: 20 })]);
      await o.flush();
      expect(text(status())).toBe('Places restored.');
      expect(status().querySelector('[tabindex="-1"]')).toBe(document.activeElement);
      expect(input().value).toBe('20');
    });

    it('a refusal because the added places are taken shows the server’s message under the status and keeps Undo', async () => {
      await open();
      await saved();
      undoButton().click();
      await o.flush();
      o.convex.calls[1].reject(
        new ConvexError({
          field: 'places',
          code: 'placesBelowRegistered',
          message: CAMP_SESSION_MESSAGES.placesBelowRegistered(21),
        }),
      );
      await o.flush();
      expect(text(status())).toBe(
        `Places saved.Undo ${CAMP_SESSION_MESSAGES.placesBelowRegistered(21)}`,
      );
      expect(undoButton()).toBeDefined();
    });

    it('any other failure says the places could not be restored, never the error message', async () => {
      await open();
      await saved();
      undoButton().click();
      await o.flush();
      o.convex.calls[1].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(status())).toBe('Places saved.Undo Places could not be restored. Try again.');
      expect(page.textContent).not.toContain('secret');
    });

    it('offline: a refusal from the adapter says nothing was undone', async () => {
      await open();
      await saved();
      undoButton().click();
      await o.flush();
      o.convex.calls[1].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(status())).toBe(
        "Places saved.Undo You're offline. Nothing was undone. Try again when you're connected.",
      );
    });
  });

  describe('a refusal from the server', () => {
    it('shows its message under the field, keeps the text, and focuses the field, with no alert', async () => {
      await open();
      await save('22');
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'places',
          code: 'placesBelowRegistered',
          message: CAMP_SESSION_MESSAGES.placesBelowRegistered(23),
        }),
      );
      await o.flush();
      expect(error()).toBe(CAMP_SESSION_MESSAGES.placesBelowRegistered(23));
      expect(input().value).toBe('22');
      expect(document.activeElement).toBe(input());
      expect(editor().querySelector('[data-slot="alert"]')).toBeNull();
      expect(text(saveButton())).toBe('Save places for Week 1');
    });

    it('clears when the user changes the text', async () => {
      await open();
      await save('22');
      o.convex.calls[0].reject(
        new ConvexError({ field: 'places', code: 'placesBelowRegistered', message: 'Refused.' }),
      );
      await o.flush();
      await type('24');
      expect(error()).toBeUndefined();
    });
  });

  describe('a failure', () => {
    it('shows the alert with what to do, keeps the text, and focuses the alert, never showing the error message', async () => {
      await open();
      await save('22');
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = editor().querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The places could not be saved.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Your change is still here. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(input().value).toBe('22');
      expect(document.activeElement).toBe(alert);
    });

    it('a refusal from the adapter at call time (offline) shows the offline alert and keeps the text', async () => {
      await open();
      await save('22');
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      const alert = editor().querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(input().value).toBe('22');
      expect(document.activeElement).toBe(alert);
    });

    it('goes when the next save is pressed', async () => {
      await open();
      await save('22');
      o.convex.calls[0].reject(new Error('Server Error'));
      await o.flush();
      saveButton().click();
      await o.flush();
      expect(editor().querySelector('[data-slot="alert"]')).toBeNull();
    });
  });

  describe('offline', () => {
    afterEach(() => vi.restoreAllMocks());

    it('the button looks disabled but stays focusable, and a press shows the offline alert, sends nothing, and keeps the text', async () => {
      await open();
      await type('22');
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      expect(saveButton().getAttribute('aria-disabled')).toBe('true');
      expect(saveButton().classList.contains('opacity-50')).toBe(true);
      expect(saveButton().hasAttribute('disabled')).toBe(false);
      saveButton().click();
      await o.flush();
      expect(o.convex.calls).toEqual([]);
      expect(text(editor().querySelector('[data-slot="alert"] [data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(input().value).toBe('22');
    });
  });
});
