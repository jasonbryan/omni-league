import { EventPhase } from '@angular/core/primitives/event-dispatch';
import { isReplayedEvent } from './replayed-event';

describe('isReplayedEvent', () => {
  it('is true for an event in the replay phase', () => {
    const event = new Event('submit');
    Object.defineProperty(event, 'eventPhase', { value: EventPhase.REPLAY });
    expect(isReplayedEvent(event)).toBe(true);
  });

  it('is false for an event the browser dispatched', () => {
    const target = new EventTarget();
    const seen: boolean[] = [];
    target.addEventListener('submit', (event) => seen.push(isReplayedEvent(event)));
    target.dispatchEvent(new Event('submit'));
    expect(seen).toEqual([false]);
  });
});
