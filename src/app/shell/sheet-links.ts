import { DestroyRef, Directive, ElementRef, Renderer2, inject, output } from '@angular/core';
import { isPlainClick } from './follow-link';

/** It listens in the capture phase, so the link's own handlers (a `routerLink`, for example) do not navigate first. */
@Directive({ selector: '[appSheetLinks]' })
export class SheetLinks {
  readonly linkActivated = output<string>();

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const stop = inject(Renderer2).listen(
      host,
      'click',
      (event: MouseEvent) => {
        this.intercept(event);
      },
      { capture: true },
    );
    inject(DestroyRef).onDestroy(stop);
  }

  private intercept(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!link || link.hasAttribute('download')) return;
    if (link.target && link.target !== '_self') return;
    event.preventDefault();
    event.stopPropagation();
    this.linkActivated.emit(link.href);
  }
}
