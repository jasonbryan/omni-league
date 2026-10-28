import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { ChangesInFlight } from '../changes-in-flight';

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** `app-checkbox` is a `<button role="checkbox">`, which fires no `input` or `change` event. */
const TOGGLE_ROLES = '[role=checkbox], [role=radio], [role=switch]';

@Injectable({ providedIn: 'root' })
export class PageSafety {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changes = inject(ChangesInFlight);

  private readonly fields = new Set<Element>();
  private watching = false;
  private touched = false;
  private readonly fieldMarkedSubject = new Subject<void>();

  readonly fieldMarked = this.fieldMarkedSubject.asObservable();

  watch(): void {
    if (this.watching) return;
    this.watching = true;
    this.listen('input', (event) => this.mark(event.target));
    this.listen('change', (event) => this.mark(event.target));
    this.listen('click', (event) => {
      const target = event.target;
      if (target instanceof Element) this.mark(target.closest(TOGGLE_ROLES));
    });
    for (const type of INTERACTION_EVENTS) this.listen(type, () => (this.touched = true));
  }

  interacted(): boolean {
    return this.touched;
  }

  hasUnsavedField(): boolean {
    for (const field of this.fields) if (!field.isConnected) this.fields.delete(field);
    return this.fields.size > 0;
  }

  isSafe(): boolean {
    return !this.hasUnsavedField() && !this.changes.active();
  }

  private listen(type: string, handler: (event: Event) => void): void {
    this.document.addEventListener(type, handler, { capture: true, passive: true });
    this.destroyRef.onDestroy(() =>
      this.document.removeEventListener(type, handler, { capture: true }),
    );
  }

  private mark(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;
    this.fields.add(target);
    this.fieldMarkedSubject.next();
  }
}
