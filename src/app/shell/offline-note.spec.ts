import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { OfflineNote } from './offline-note';

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
    client = new FakeConvexClient();
    TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
    fixture = TestBed.createComponent(OfflineNote);
    region = fixture.nativeElement as HTMLElement;
    TestBed.tick();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is an empty, sticky status region below the top bar while online', () => {
    expect(region.getAttribute('role')).toBe('status');
    expect(region.className).toBe('sticky top-14 z-20 block bg-foreground text-background');
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
});
