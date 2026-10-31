import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injector, afterEveryRender, inject } from '@angular/core';

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

export interface SectionJump {
  /** Scrolls to the section and focuses its target, or the section (`tabindex="-1"`) until the target renders. */
  jump(section: HTMLElement): void;
}

/**
 * A target that renders after the press takes focus then, unless the user has pressed, focused, or
 * scrolled since.
 */
export function injectSectionJump(
  targetIn: (section: HTMLElement) => HTMLElement | null,
): SectionJump {
  const document = inject(DOCUMENT);
  const injector = inject(Injector);
  let cancelPending: (() => void) | null = null;
  inject(DestroyRef).onDestroy(() => cancelPending?.());

  function focusTargetWhenRendered(section: HTMLElement): void {
    const listening = new AbortController();
    const render = afterEveryRender(
      {
        write: () => {
          const target = targetIn(section);
          if (!target) return;
          cancel();
          target.scrollIntoView({ block: 'nearest' });
          target.focus({ preventScroll: true });
        },
      },
      { injector },
    );
    const cancel = () => {
      listening.abort();
      render.destroy();
      cancelPending = null;
    };
    cancelPending = cancel;

    const options = { capture: true, passive: true, signal: listening.signal };
    document.addEventListener(
      'focusin',
      (event) => {
        if (event.target !== section) cancel();
      },
      options,
    );
    // A click counts as well as focus, because a click or tap does not focus a link in WebKit.
    document.addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Element && event.target.closest(CONTROL)) cancel();
      },
      options,
    );
    // The jump's own scrolling fires only `scroll`, which is not listened to.
    document.addEventListener(
      'keydown',
      (event) => {
        if (SCROLL_KEYS.has(event.key)) cancel();
      },
      options,
    );
    document.addEventListener('wheel', cancel, options);
    document.addEventListener('touchmove', cancel, options);
  }

  return {
    jump(section: HTMLElement): void {
      cancelPending?.();
      section.scrollIntoView();
      const target = targetIn(section);
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
      section.focus({ preventScroll: true });
      focusTargetWhenRendered(section);
    },
  };
}
