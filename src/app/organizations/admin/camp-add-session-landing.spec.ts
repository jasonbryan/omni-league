import { forbiddenError, openAdmin } from './testing/admin-harness';
import { CampAddSessionLanding } from './camp-add-session-landing';
import {
  AS_ORGANIZER,
  CAMP,
  CAMPS_BASE,
  CAMP_ROUTES,
  CAMP_URL,
  GET_CAMP,
  LIST_SESSIONS,
} from './testing/camp-harness';

const OTHER_URL = `${CAMPS_BASE}/fall-break-camp`;
const OTHER = { ...CAMP, campId: 'cp_fall', name: 'Fall Break Camp', slug: 'fall-break-camp' };

describe('CampAddSessionLanding', () => {
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
    o = await openAdmin(CAMP_ROUTES, url);
    o.acceptToken();
    await o.flush();
  }

  const landing = () => o.harness.routeDebugElement!.injector.get(CampAddSessionLanding);
  const main = () => o.harness.routeNativeElement!.querySelector<HTMLElement>('main')!;
  const name = () => main().querySelector<HTMLInputElement>('#add-session #name');
  const answer = async (camp: object | null = CAMP) => {
    o.subscription(GET_CAMP)!.emit(camp);
    await o.flush();
    o.subscription(LIST_SESSIONS)?.emit([]);
    await o.flush();
  };
  const expectLanded = () => {
    expect(landing().pending()).toBe(false);
    expect(scrolled.mock.contexts as Element[]).toEqual([main().querySelector('#add-session')]);
    expect(document.activeElement).toBe(name());
  };
  const expectNothingLanded = () => {
    expect(landing().pending()).toBe(false);
    expect(scrolled).not.toHaveBeenCalled();
    expect(main().contains(document.activeElement) && document.activeElement !== main()).toBe(
      false,
    );
  };

  describe('arming', () => {
    it('arms for a camp page opened with #add-session', async () => {
      await open(`${CAMP_URL}#add-session`);
      expect(landing().pending()).toBe(true);
    });

    it.each([
      ['no fragment', CAMP_URL],
      ['another fragment', `${CAMP_URL}#sessions`],
    ])('does not arm for %s', async (_label, url) => {
      await open(url);
      expect(landing().pending()).toBe(false);
    });
  });

  describe('landing', () => {
    it('waits for the camp, then scrolls to the form and focuses Name, without waiting for the sessions', async () => {
      await open(`${CAMP_URL}#add-session`);
      expect(scrolled).not.toHaveBeenCalled();
      o.subscription(GET_CAMP)!.emit(CAMP);
      await o.flush();
      expectLanded();
    });

    it('does not move again when the camp changes after it landed', async () => {
      await open(`${CAMP_URL}#add-session`);
      await answer();
      scrolled.mockClear();
      (document.activeElement as HTMLElement).blur();
      await answer({ ...CAMP, minimumAge: 10 });
      expect(scrolled).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(name());
    });

    it('lands for an assigned league organizer too', async () => {
      await open(`${CAMP_URL}#add-session`);
      await answer(AS_ORGANIZER);
      expectLanded();
    });
  });

  describe('nothing to land on', () => {
    it('settles on the not-found view', async () => {
      await open(`${CAMP_URL}#add-session`);
      await answer(null);
      expectNothingLanded();
    });

    it('settles on the no-access view', async () => {
      await open(`${CAMP_URL}#add-session`);
      o.subscription(GET_CAMP)!.fail(forbiddenError());
      await o.flush();
      expectNothingLanded();
    });

    it('settles on the error view', async () => {
      await open(`${CAMP_URL}#add-session`);
      o.subscription(GET_CAMP)!.fail(new Error('connect ECONNREFUSED'));
      await o.flush();
      expectNothingLanded();
    });
  });

  describe('cancelling', () => {
    it('does not land after a scroll while the camp query is held', async () => {
      await open(`${CAMP_URL}#add-session`);
      document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      expect(landing().pending()).toBe(false);
      await answer();
      expect(scrolled).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(name());
    });

    it('keeps the landing when <main> takes focus', async () => {
      await open(`${CAMP_URL}#add-session`);
      main().focus();
      expect(landing().pending()).toBe(true);
      await answer();
      expectLanded();
    });
  });

  describe('arriving at another camp', () => {
    it('lands on the form of camp B when the page already shows A and the link carries #add-session', async () => {
      await open(CAMP_URL);
      await answer();
      expect(landing().pending()).toBe(false);
      await o.harness.navigateByUrl(`${OTHER_URL}#add-session`);
      await o.flush();
      expect(landing().pending()).toBe(true);
      await answer(OTHER);
      expectLanded();
    });

    it('does not arm on a change of fragment alone on the same camp', async () => {
      await open(CAMP_URL);
      await answer();
      await o.harness.navigateByUrl(`${CAMP_URL}#add-session`);
      await o.flush();
      expect(landing().pending()).toBe(false);
      expect(scrolled).not.toHaveBeenCalled();
    });
  });
});
