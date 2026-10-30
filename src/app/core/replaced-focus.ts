import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  Injectable,
  PLATFORM_ID,
  afterNextRender,
  inject,
} from '@angular/core';

const MAIN = '#main';
const PRESSABLE = 'a[href], button';

/**
 * The element last pressed or focused inside `#main`. A click counts as well as focus, because a click or tap does not focus a link
 * in WebKit.
 */
@Injectable({ providedIn: 'root' })
export class MainFocusRecord {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private last: Element | null = null;
  private listening = false;

  /** Called by the layouts that hold `#main`, so the record exists before anything in it is pressed. */
  listen(): void {
    if (!this.browser || this.listening) return;
    this.listening = true;
    const onFocusIn = (event: FocusEvent) => this.record(event.target);
    const onClick = (event: MouseEvent) => {
      const pressed = event.target instanceof Element ? event.target.closest(PRESSABLE) : null;
      if (pressed) this.record(pressed);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget !== null) return;
      const left = event.target;
      // Some engines fire focusout as they remove a focused element; only an element still in the page lost focus to nothing.
      queueMicrotask(() => {
        if (left === this.last && left instanceof Element && left.isConnected) this.last = null;
      });
    };
    const options = { capture: true };
    this.document.addEventListener('focusin', onFocusIn, options);
    this.document.addEventListener('click', onClick, options);
    this.document.addEventListener('focusout', onFocusOut, options);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('focusin', onFocusIn, options);
      this.document.removeEventListener('click', onClick, options);
      this.document.removeEventListener('focusout', onFocusOut, options);
    });
  }

  /** The element last pressed or focused inside `#main` has left the page, and focus fell to `<body>` with it. */
  focusFellWithRemovedElement(): boolean {
    const active = this.document.activeElement;
    const onBody = active === null || active === this.document.body;
    return onBody && this.last !== null && !this.last.isConnected;
  }

  lastIsInside(host: Element): boolean {
    return this.last !== null && host.contains(this.last);
  }

  focusMain(): void {
    this.document.querySelector<HTMLElement>(MAIN)?.focus();
  }

  private record(target: EventTarget | null): void {
    this.last = target instanceof Element && target.closest(MAIN) ? target : null;
  }
}

/**
 * For a view that replaces a page's content (ux.md, Feedback and Navigation): it takes focus on its heading when the element last
 * pressed or focused went with the content, and gives focus to `#main` when the content returns while focus is inside it.
 */
export function focusWhenReplacing(heading: () => HTMLElement): void {
  const record = inject(MainFocusRecord);
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const environment = inject(EnvironmentInjector);
  afterNextRender({
    write: () => {
      if (record.focusFellWithRemovedElement()) heading().focus();
    },
  });
  inject(DestroyRef).onDestroy(() => {
    if (!record.lastIsInside(host)) return;
    // The read phase runs after the write phase, so a view that replaces this one takes focus first.
    afterNextRender(
      {
        read: () => {
          if (record.focusFellWithRemovedElement()) record.focusMain();
        },
      },
      { injector: environment },
    );
  });
}
