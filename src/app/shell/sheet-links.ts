import { DestroyRef, Directive, ElementRef, Renderer2, inject, output } from '@angular/core';
import { isPlainClick } from './follow-link';

/**
 * On the phone sheet's sidebar wrapper: a plain activation of any link inside is held back and
 * reported, so the shell can close the sheet before the link runs (#75). It listens in the capture
 * phase, so the link's own handlers (a `routerLink`, for example) do not navigate first. The sheet
 * exists only after it opens in the browser, so this never runs on the server.
 */
@Directive({ selector: '[appSheetLinks]' })
export class SheetLinks {
  /** The activated link's absolute URL. */
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
