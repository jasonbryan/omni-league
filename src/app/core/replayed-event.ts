import { EventPhase } from '@angular/core/primitives/event-dispatch';

/** The browser has already acted on a replayed event, so Angular makes `preventDefault` throw. */
export function isReplayedEvent(event: Event): boolean {
  return event.eventPhase === EventPhase.REPLAY;
}
