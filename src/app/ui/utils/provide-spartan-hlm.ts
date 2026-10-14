import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';

/**
 * Configures the Angular CDK overlay to disable the `usePopover` behavior introduced in Angular 21, which causes CDK overlay-based components
 * (sheets, dialogs, tooltips, etc.) to render above `position: fixed` elements like `<hlm-toaster>`.
 */
export function provideSpartanHlm(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: OVERLAY_DEFAULT_CONFIG,
      useValue: { usePopover: false },
    },
  ]);
}
