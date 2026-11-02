import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injector, afterEveryRender, inject } from '@angular/core';
import { onLaterChoiceOrScroll } from '../../core/later-choice';

export interface SectionJump {
  /** The section needs `tabindex="-1"`: it holds focus until its target renders. */
  jump(section: HTMLElement): void;
}

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
    onLaterChoiceOrScroll(
      document,
      { isOwnFocus: (element) => element === section, signal: listening.signal },
      cancel,
    );
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
