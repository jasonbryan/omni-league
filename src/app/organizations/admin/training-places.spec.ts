import { ConvexError } from 'convex/values';
import { TRAINING_PATTERN_MESSAGES } from '../../../../convex/lib/trainingPattern';
import { openAdmin, text } from './testing/admin-harness';
import {
  CLASSES,
  GET_TRAINING,
  LIST_CLASSES,
  RESTORE_PLACES,
  SCHEDULED_TRAINING,
  TRAINING_ROUTES,
  TRAINING_URL,
  UPDATE_ALL_PLACES,
  UPDATE_CLASS_PLACES,
  trainingClass,
} from './testing/training-harness';

describe('PlacesEditor on the training management page', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 10, 15, 12, 0, 0) }));
  afterEach(() => vi.useRealTimers());

  async function open(classes: unknown[] = CLASSES) {
    o = await openAdmin(TRAINING_ROUTES, TRAINING_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_TRAINING)!.emit(SCHEDULED_TRAINING);
    await o.flush();
    o.subscription(LIST_CLASSES)!.emit(classes);
    await o.flush();
  }

  const row = (date: string) =>
    [...page.querySelectorAll<HTMLElement>('#classes-list > li')].find(
      (li) => text(li.querySelector('[data-slot="class-date"]')) === date,
    )!;
  const rowEditor = (date: string) => row(date).querySelector<HTMLElement>('app-places-editor');
  const all = () => page.querySelector<HTMLElement>('[data-slot="all-places"]');
  const allEditor = () => all()!.querySelector<HTMLElement>('app-places-editor')!;
  const input = (editor: HTMLElement) => editor.querySelector<HTMLInputElement>('input')!;
  const save = (editor: HTMLElement) =>
    editor.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const status = (editor: HTMLElement) =>
    editor.querySelector<HTMLElement>('[data-slot="places-status"]')!;
  const error = (editor: HTMLElement) => text(editor.querySelector('[data-slot="field-error"]'));

  async function enter(editor: HTMLElement, value: string) {
    input(editor).value = value;
    input(editor).dispatchEvent(new Event('input', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function press(editor: HTMLElement) {
    save(editor).focus();
    save(editor).click();
    await o.flush();
  }

  describe('a class row', () => {
    it('has a field for each scheduled class, named by its date, holding its places, and none on a cancelled class', async () => {
      await open();
      const editor = rowEditor('Tue, Jan 5, 2027')!;
      expect(text(editor.querySelector('label'))).toBe('Places for Tue, Jan 5, 2027');
      expect(input(editor).value).toBe('12');
      expect(rowEditor('Tue, Jan 12, 2027')).not.toBeNull();
      expect(rowEditor('Tue, Jan 19, 2027')).toBeNull();
    });

    it('says the range, from the registered count up to 200', async () => {
      await open();
      expect(
        text(rowEditor('Tue, Jan 5, 2027')!.querySelector('[data-slot="field-description"]')),
      ).toBe('From 1 to 200.');
      expect(
        text(rowEditor('Tue, Jan 12, 2027')!.querySelector('[data-slot="field-description"]')),
      ).toBe('From 3 to 200.');
    });

    it('shows places below the registered count under the field on leaving it, with the shared message', async () => {
      await open();
      const editor = rowEditor('Tue, Jan 12, 2027')!;
      await enter(editor, '2');
      expect(error(editor)).toBeUndefined();
      input(editor).dispatchEvent(new Event('blur'));
      await o.harness.fixture.whenStable();
      expect(error(editor)).toBe(TRAINING_PATTERN_MESSAGES.placesBelowRegistered(3));
      expect(input(editor).value).toBe('2');
    });

    it('sends the class and the places, says "Places saved." with Undo, and Undo sends the places it replaced', async () => {
      await open();
      const editor = rowEditor('Tue, Jan 5, 2027')!;
      await enter(editor, '14');
      await press(editor);
      expect(o.convex.calls.map((c) => [c.name, c.args])).toEqual([
        [UPDATE_CLASS_PLACES, { trainingClassId: 'tc_1', places: 14 }],
      ]);
      o.convex.calls[0].resolve({ previousPlaces: 12 });
      await o.flush();
      expect(text(status(editor))).toBe('Places saved.Undo');

      [...status(editor).querySelectorAll('button')].find((b) => text(b) === 'Undo')!.click();
      await o.flush();
      expect(o.convex.calls[1].name).toBe(UPDATE_CLASS_PLACES);
      expect(o.convex.calls[1].args).toEqual({ trainingClassId: 'tc_1', places: 12 });
      o.convex.calls[1].resolve({ previousPlaces: 14 });
      await o.flush();
      expect(text(status(editor))).toBe('Places restored.');
    });

    it('shows the server’s refusal under the field and keeps the text', async () => {
      await open();
      const editor = rowEditor('Tue, Jan 5, 2027')!;
      await enter(editor, '14');
      await press(editor);
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'places',
          code: 'placesBelowRegistered',
          message: TRAINING_PATTERN_MESSAGES.placesBelowRegistered(15),
        }),
      );
      await o.flush();
      expect(error(editor)).toBe(TRAINING_PATTERN_MESSAGES.placesBelowRegistered(15));
      expect(input(editor).value).toBe('14');
    });

    it('still has its field after the class list changes under it', async () => {
      await open();
      o.subscription(LIST_CLASSES)!.emit([trainingClass({ places: 16 })]);
      await o.flush();
      expect(input(rowEditor('Tue, Jan 5, 2027')!).value).toBe('16');
    });
  });

  describe('Change places for every class', () => {
    it('is a section with its own heading and a field for every upcoming class, from 1 to 200', async () => {
      await open();
      expect(text(all()!.querySelector('h3'))).toBe('Change places for every class');
      const editor = allEditor();
      expect(text(editor.querySelector('label'))).toBe('Places for every upcoming class');
      expect(text(editor.querySelector('[data-slot="field-description"]'))).toBe('From 1 to 200.');
      expect(input(editor).value).toBe('12');
    });

    it('is not shown while the classes load, when they failed, with no classes, or with only cancelled or past ones', async () => {
      o = await openAdmin(TRAINING_ROUTES, TRAINING_URL);
      page = o.page;
      o.acceptToken();
      await o.flush();
      o.subscription(GET_TRAINING)!.emit(SCHEDULED_TRAINING);
      await o.flush();
      expect(all()).toBeNull();
      o.subscription(LIST_CLASSES)!.emit([]);
      await o.flush();
      expect(all()).toBeNull();
      o.subscription(LIST_CLASSES)!.emit([
        trainingClass({ status: 'cancelled' }),
        trainingClass({ trainingClassId: 'tc_9', date: '2026-11-10' }),
      ]);
      await o.flush();
      expect(all()).toBeNull();
      o.subscription(LIST_CLASSES)!.emit([trainingClass({ date: '2026-11-17' })]);
      await o.flush();
      expect(all()).not.toBeNull();
    });

    it('sends the training program and the places, says how many classes changed, and Undo sends each class’s previous places', async () => {
      await open();
      const editor = allEditor();
      await enter(editor, '14');
      await press(editor);
      expect(o.convex.calls.map((c) => [c.name, c.args])).toEqual([
        [UPDATE_ALL_PLACES, { trainingId: 'tr_serving', places: 14 }],
      ]);
      const previous = [
        { trainingClassId: 'tc_1', places: 12 },
        { trainingClassId: 'tc_2', places: 9 },
        { trainingClassId: 'tc_3', places: 12 },
      ];
      o.convex.calls[0].resolve({ classCount: 2, previous });
      await o.flush();
      expect(text(status(editor))).toBe('Places saved for 2 classes.Undo');

      [...status(editor).querySelectorAll('button')].find((b) => text(b) === 'Undo')!.click();
      await o.flush();
      expect(o.convex.calls[1].name).toBe(RESTORE_PLACES);
      expect(o.convex.calls[1].args).toEqual({ trainingId: 'tr_serving', classes: previous });
      o.convex.calls[1].resolve({ classCount: 3 });
      await o.flush();
      expect(text(status(editor))).toBe('Places restored for 2 classes.');
    });

    it('says "1 class" for one', async () => {
      await open();
      const editor = allEditor();
      await enter(editor, '14');
      await press(editor);
      o.convex.calls[0].resolve({
        classCount: 1,
        previous: [{ trainingClassId: 'tc_1', places: 12 }],
      });
      await o.flush();
      expect(text(status(editor))).toBe('Places saved for 1 class.Undo');
    });

    it('shows the server’s refusal, which names the class by its date, under the field and keeps the text', async () => {
      await open();
      const editor = allEditor();
      await enter(editor, '2');
      await press(editor);
      expect(error(editor)).toBeUndefined();
      expect(o.convex.calls).toHaveLength(1);
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'places',
          code: 'placesBelowRegistered',
          message: TRAINING_PATTERN_MESSAGES.classBelowRegistered('2027-01-12', 3),
        }),
      );
      await o.flush();
      expect(error(editor)).toBe(
        'Tue, Jan 12, 2027 has 3 registered, so it needs at least 3 places. Nothing was changed.',
      );
      expect(input(editor).value).toBe('2');
    });

    it('checks only the range itself, so the server names the class that is too full', async () => {
      await open();
      const editor = allEditor();
      await enter(editor, '201');
      input(editor).dispatchEvent(new Event('blur'));
      await o.harness.fixture.whenStable();
      expect(error(editor)).toBe('Enter a whole number of places from 1 to 200.');
    });
  });
});
