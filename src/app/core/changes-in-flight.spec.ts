import { TestBed } from '@angular/core/testing';
import { ChangesInFlight } from './changes-in-flight';

describe('ChangesInFlight', () => {
  it('is active from begin() until every change has ended, and emits settled once at zero', () => {
    const changes = TestBed.inject(ChangesInFlight);
    const settled = vi.fn();
    changes.settled.subscribe(settled);
    expect(changes.active()).toBe(false);

    const endFirst = changes.begin();
    const endSecond = changes.begin();
    expect(changes.active()).toBe(true);

    endFirst();
    expect(changes.active()).toBe(true);
    expect(settled).not.toHaveBeenCalled();

    endSecond();
    expect(changes.active()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('ends a change once, however many times its end function is called', () => {
    const changes = TestBed.inject(ChangesInFlight);
    const endFirst = changes.begin();
    changes.begin();

    endFirst();
    endFirst();

    expect(changes.active()).toBe(true);
  });

  it('track() counts the work while it runs, and when it rejects', async () => {
    const changes = TestBed.inject(ChangesInFlight);
    let fail: (error: Error) => void = () => undefined;
    const work = changes.track(() => new Promise<void>((_, reject) => (fail = reject)));
    expect(changes.active()).toBe(true);

    fail(new Error('network'));
    await expect(work).rejects.toThrow('network');
    expect(changes.active()).toBe(false);
  });
});
