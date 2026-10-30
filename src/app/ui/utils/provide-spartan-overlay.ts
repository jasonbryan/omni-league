import { Overlay, OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import type { Provider, Type } from '@angular/core';

/**
 * The CDK reads `OVERLAY_DEFAULT_CONFIG` from the injector of the `Overlay` or `Dialog` that opens the overlay, and they and the brain services that use them are root-provided, so the host provides its own; in the root config the token would pull the CDK overlay code into the initial bundle.
 * The host passes the services its overlay opens through, so no host bundles another kind's code.
 */
export function provideSpartanOverlay(...openers: Type<unknown>[]): Provider[] {
  return [
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    Overlay,
    ...openers,
  ];
}
