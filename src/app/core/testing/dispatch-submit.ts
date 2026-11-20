import { EventPhase } from '@angular/core/primitives/event-dispatch';

export function dispatchSubmit(
  form: HTMLFormElement,
  { replayed = false }: { replayed?: boolean } = {},
): { preventDefaultCalls: () => number } {
  const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
  // Angular's replay patches the instance the same way, and a real dispatch leaves an own property alone.
  if (replayed) Object.defineProperty(event, 'eventPhase', { value: EventPhase.REPLAY });
  let calls = 0;
  event.preventDefault = () => {
    calls += 1;
    Event.prototype.preventDefault.call(event);
  };
  form.dispatchEvent(event);
  return { preventDefaultCalls: () => calls };
}
