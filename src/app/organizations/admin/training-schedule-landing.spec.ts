import { forbiddenError, openAdmin } from './testing/admin-harness';
import { TrainingScheduleLanding } from './training-schedule-landing';
import {
  CLASSES,
  GET_TRAINING,
  LIST_CLASSES,
  TRAINING,
  TRAINING_ROUTES,
  TRAINING_URL,
} from './testing/training-harness';

describe('TrainingScheduleLanding', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let scrolled: ReturnType<typeof vi.fn<() => void>>;
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    // jsdom has no scrollIntoView.
    scrolled = vi.fn<() => void>();
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  async function open(url: string) {
    o = await openAdmin(TRAINING_ROUTES, url);
    o.acceptToken();
    await o.flush();
  }

  const landing = () => o.harness.routeDebugElement!.injector.get(TrainingScheduleLanding);
  const main = () => o.harness.routeNativeElement!.querySelector<HTMLElement>('main')!;
  const firstChip = () => main().querySelector<HTMLInputElement>('#schedule #weekday input');
  const answer = async (training: object | null = TRAINING, classes: unknown[] = []) => {
    o.subscription(GET_TRAINING)!.emit(training);
    await o.flush();
    o.subscription(LIST_CLASSES)?.emit(classes);
    await o.flush();
  };

  describe('arming', () => {
    it('arms for a training page opened with #schedule', async () => {
      await open(`${TRAINING_URL}#schedule`);
      expect(landing().pending()).toBe(true);
    });

    it.each([
      ['no fragment', TRAINING_URL],
      ['another fragment', `${TRAINING_URL}#classes`],
    ])('does not arm for %s', async (_label, url) => {
      await open(url);
      expect(landing().pending()).toBe(false);
    });
  });

  describe('landing', () => {
    it('waits for the training program and its classes, then scrolls to the form and focuses the first weekday', async () => {
      await open(`${TRAINING_URL}#schedule`);
      o.subscription(GET_TRAINING)!.emit(TRAINING);
      await o.flush();
      expect(scrolled).not.toHaveBeenCalled();
      expect(landing().pending()).toBe(true);
      o.subscription(LIST_CLASSES)!.emit([]);
      await o.flush();
      expect(landing().pending()).toBe(false);
      expect(scrolled.mock.contexts as Element[]).toEqual([main().querySelector('#schedule')]);
      expect(document.activeElement).toBe(firstChip());
    });

    it('lands nothing, and stops waiting, when classes exist and the form is gone', async () => {
      await open(`${TRAINING_URL}#schedule`);
      await answer(TRAINING, CLASSES);
      expect(landing().pending()).toBe(false);
      expect(scrolled).not.toHaveBeenCalled();
      expect(main().querySelector('#schedule')).toBeNull();
    });

    it.each([
      ['not found', null],
      ['forbidden', 'forbidden'],
    ])('lands nothing and stops waiting when the answer is %s', async (_label, result) => {
      await open(`${TRAINING_URL}#schedule`);
      if (result === null) await answer(null);
      else {
        o.subscription(GET_TRAINING)!.fail(forbiddenError());
        await o.flush();
      }
      expect(landing().pending()).toBe(false);
      expect(scrolled).not.toHaveBeenCalled();
    });

    it('does not land for a page opened without the fragment', async () => {
      await open(TRAINING_URL);
      await answer();
      expect(scrolled).not.toHaveBeenCalled();
    });
  });
});
