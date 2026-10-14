import { Directive, computed, effect, input, untracked } from '@angular/core';
import { injectCustomClassSettable } from '@spartan-ng/brain/core';
import { BrnSheetOverlay } from '@spartan-ng/brain/sheet';
import { hlm } from '../utils';
import type { ClassValue } from 'clsx';

// Vendored from spartan helm 1.6.0 (Nova style). Local change, to keep when re-copying from upstream:
// the scrim is the approved `bg-foreground/50` with no backdrop blur, in place of Nova's 10% black with a blur.
@Directive({
  selector: '[hlmSheetOverlay],hlm-sheet-overlay',
  hostDirectives: [BrnSheetOverlay],
})
export class HlmSheetOverlay {
  private readonly _classSettable = injectCustomClassSettable({ optional: true, host: true });
  public readonly userClass = input<ClassValue>('', { alias: 'class' });
  protected readonly _computedClass = computed(() =>
    hlm(
      'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 isolate bg-foreground/50 duration-100',
      this.userClass(),
    ),
  );

  constructor() {
    effect(() => {
      const classValue = this._computedClass();
      untracked(() => this._classSettable?.setClassToCustomElement(classValue));
    });
  }
}
