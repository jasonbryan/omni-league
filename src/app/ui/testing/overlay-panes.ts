/**
 * jsdom has no popover API, and without it the CDK never puts an overlay in the browser's top layer whatever its config says.
 * Stubbing the API lets a unit test tell an overlay opened with `usePopover: false` from one opened with the CDK default.
 */
export function stubPopoverApi(): void {
  for (const method of ['showPopover', 'hidePopover'] as const) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  }
}

export function removePopoverApi(): void {
  for (const method of ['showPopover', 'hidePopover'] as const) {
    Reflect.deleteProperty(HTMLElement.prototype, method);
  }
}

/** Each open overlay pane, with whether it sits in `.cdk-overlay-container` and whether a `popover` element holds it. */
export function overlayPanes(): { inContainer: boolean; inPopover: boolean }[] {
  return [...document.querySelectorAll('.cdk-overlay-pane')].map((pane) => ({
    inContainer: pane.closest('.cdk-overlay-container') !== null,
    inPopover: pane.closest('[popover]') !== null,
  }));
}
