import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { OfflineNote } from './offline-note';

/** Stands in for `ResizeObserver` (jsdom has none): records what it observes and its callback. */
class FakeResizeObserver {
  static last: FakeResizeObserver | undefined;
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.last = this;
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

const noteHeightVar = () => document.documentElement.style.getPropertyValue('--offline-note-h');

function setBrowserOnline(online: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

describe('OfflineNote', () => {
  let client: FakeConvexClient;
  let fixture: ComponentFixture<OfflineNote>;
  let region: HTMLElement;

  const note = () => region.querySelector<HTMLElement>('[data-offline-note]');

  beforeEach(() => {
    vi.useFakeTimers();
    FakeResizeObserver.last = undefined;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    client = new FakeConvexClient();
    TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
    fixture = TestBed.createComponent(OfflineNote);
    region = fixture.nativeElement as HTMLElement;
    TestBed.tick();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is an empty, sticky status region below the top bar while online', () => {
    expect(region.getAttribute('role')).toBe('status');
    expect(region.classList).toContain('sticky');
    expect(region.classList).toContain('top-[var(--top-bar-h,3.5rem)]');
    expect(region.textContent.trim()).toBe('');
    expect(region.querySelector('a, button, input, [tabindex]')).toBeNull();
  });

  it('shows the note while the browser is offline and removes it when online returns', () => {
    setBrowserOnline(false);
    TestBed.tick();

    expect(note()?.textContent.replace(/\s+/g, ' ').trim()).toBe(
      "You're offline. Changes need a connection.",
    );
    expect(note()?.querySelector('.font-semibold')?.textContent).toBe("You're offline.");
    expect(note()?.querySelector('ng-icon')?.getAttribute('aria-hidden')).toBe('true');

    setBrowserOnline(true);
    TestBed.tick();
    expect(note()).toBeNull();
  });

  it('shows the note 5 s after the socket drops', async () => {
    client.setConnected(false);
    await vi.advanceTimersByTimeAsync(4_900);
    TestBed.tick();
    expect(note()).toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    TestBed.tick();
    expect(note()).not.toBeNull();

    client.setConnected(true);
    TestBed.tick();
    expect(note()).toBeNull();
  });

  it('says "Back online." to screen readers only, for 5 s after the note goes', async () => {
    setBrowserOnline(false);
    TestBed.tick();
    setBrowserOnline(true);
    TestBed.tick();

    const back = region.querySelector('.sr-only');
    expect(back?.textContent.trim()).toBe('Back online.');

    await vi.advanceTimersByTimeAsync(4_900);
    TestBed.tick();
    expect(region.textContent.trim()).toBe('Back online.');
    await vi.advanceTimersByTimeAsync(100);
    TestBed.tick();
    expect(region.textContent.trim()).toBe('');
  });

  it('drops "Back online." at once when the connection is lost again', async () => {
    setBrowserOnline(false);
    TestBed.tick();
    setBrowserOnline(true);
    TestBed.tick();
    setBrowserOnline(false);
    TestBed.tick();

    expect(region.querySelector('.sr-only')).toBeNull();
    expect(note()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(10_000);
    TestBed.tick();
    expect(note()).not.toBeNull();
  });

  it('says nothing at start while online', async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    TestBed.tick();
    expect(region.textContent.trim()).toBe('');
  });

  it('sets --offline-note-h on <html> to the measured height of the region as it resizes', () => {
    const observer = FakeResizeObserver.last;
    expect(observer?.observed).toEqual([region]);
    expect(noteHeightVar()).toBe('');

    let height = 56;
    vi.spyOn(region, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 56, 320, height),
    );
    observer?.callback();
    expect(noteHeightVar()).toBe('56px');

    height = 36;
    observer?.callback();
    expect(noteHeightVar()).toBe('36px');

    height = 0;
    observer?.callback();
    expect(noteHeightVar()).toBe('');
  });

  it('removes --offline-note-h and stops observing when destroyed', () => {
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 56, 320, 36));
    FakeResizeObserver.last?.callback();
    expect(noteHeightVar()).toBe('36px');

    fixture.destroy();
    expect(noteHeightVar()).toBe('');
    expect(FakeResizeObserver.last?.disconnected).toBe(true);
  });
});
