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
  /** Focus moving to one of these is the page's own doing, not the user's. */
  readonly exclude: readonly Element[];
  readonly signal: AbortSignal;
}

export function onLaterChoiceOrScroll(
  document: Document,
  { exclude, signal }: LaterChoiceOptions,
  onChoice: () => void,
): void {
  const options = { capture: true, passive: true, signal };
  document.addEventListener(
    'focusin',
    (event) => {
      if (!exclude.includes(event.target as Element)) onChoice();
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
