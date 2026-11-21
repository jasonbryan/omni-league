import { EventPhase } from '@angular/core/primitives/event-dispatch';

interface Dispatched {
  preventDefaultCalls: () => number;
}

function dispatch(target: Element, event: Event, replayed: boolean): Dispatched {
  // Angular's replay patches the instance the same way, and a real dispatch leaves an own property alone.
  if (replayed) Object.defineProperty(event, 'eventPhase', { value: EventPhase.REPLAY });
  let calls = 0;
  event.preventDefault = () => {
    calls += 1;
    Event.prototype.preventDefault.call(event);
  };
  target.dispatchEvent(event);
  return { preventDefaultCalls: () => calls };
}

export function dispatchSubmit(
  form: HTMLFormElement,
  { replayed = false }: { replayed?: boolean } = {},
): Dispatched {
  return dispatch(form, new SubmitEvent('submit', { bubbles: true, cancelable: true }), replayed);
}

export function dispatchClick(
  element: Element,
  { replayed = false, init = {} }: { replayed?: boolean; init?: MouseEventInit } = {},
): Dispatched {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  return dispatch(element, event, replayed);
}
