import { Dialog } from '@angular/cdk/dialog';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import type { Provider } from '@angular/core';
import { BrnDialogService } from '@spartan-ng/brain/dialog';

/**
 * For a component that hosts a brain sheet, dialog, or alert dialog: its overlays stay in `.cdk-overlay-container`, stacked by z-index, instead of the browser's popover top layer.
 * The CDK reads `OVERLAY_DEFAULT_CONFIG` from the injector of the `Dialog` that opens the overlay, so `Dialog` and the `BrnDialogService` that uses it are provided here too; in the root config the token would pull the CDK overlay code into the initial bundle.
 */
export function provideSpartanOverlay(): Provider[] {
  return [
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    Dialog,
    BrnDialogService,
  ];
}
