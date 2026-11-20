import { EventPhase } from '@angular/core/primitives/event-dispatch';

/** Dispatches a submit on `form`, counting the calls to the event's `preventDefault`. */
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
  // Stops jsdom from navigating after a submit that no handler prevented.
  const stopNavigation = () => Event.prototype.preventDefault.call(event);
  window.addEventListener('submit', stopNavigation, { once: true });
  form.dispatchEvent(event);
  window.removeEventListener('submit', stopNavigation);
  return { preventDefaultCalls: () => calls };
}
