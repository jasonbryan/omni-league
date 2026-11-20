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
    const phases: number[] = [];
    target.addEventListener('submit', (event) => phases.push(event.eventPhase));
    target.dispatchEvent(new Event('submit'));
    expect(phases).toEqual([Event.AT_TARGET]);
    expect(isReplayedEvent(new Event('submit'))).toBe(false);
  });
});
