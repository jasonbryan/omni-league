const SCROLL_KEYS = new Set([
  ' ',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
const CONTROL = 'a[href], button, input, select, textarea, label, summary';

export interface LaterChoiceOptions {
  /** Focus moving to an element this accepts is the page's own doing, not the user's. */
  readonly isOwnFocus: (element: Element) => boolean;
  readonly isOwnArea: (element: Element) => boolean;
  readonly signal: AbortSignal;
}

export function onLaterChoiceOrScroll(
  document: Document,
  { isOwnFocus, isOwnArea, signal }: LaterChoiceOptions,
  onChoice: () => void,
): void {
  const options = { capture: true, passive: true, signal };
  document.addEventListener(
    'focusin',
    (event) => {
      if (!isOwnFocus(event.target as Element)) onChoice();
    },
    options,
  );
  // A click counts as well as focus, because a click or tap does not focus a link in WebKit.
  document.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest(CONTROL)) onChoice();
    },
    options,
  );
  // A press on plain text outside the own area counts too: Playwright's engines move focus to
  // <body> without a focusin, and iOS Safari sends no click from text to a delegated listener.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target instanceof Element && !isOwnArea(event.target)) onChoice();
    },
    options,
  );
  // Tab counts because Shift+Tab out of the page fires no focusin in WebKit. Programmatic scrolling
  // fires only `scroll`, which is not listened to.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Tab' || SCROLL_KEYS.has(event.key)) onChoice();
    },
    options,
  );
  document.addEventListener('wheel', onChoice, options);
  document.addEventListener('touchmove', onChoice, options);
}
