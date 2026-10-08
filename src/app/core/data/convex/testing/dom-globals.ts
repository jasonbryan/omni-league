/**
 * Snapshot of the DOM classes on `globalThis`, for specs that call `renderApplication` in jsdom.
 *
 * With DOM emulation on (the default), `@angular/platform-server` runs `Object.assign(globalThis,
 * domino.impl)`, replacing jsdom's `Event`, `Node`, `HTMLElement` and the rest with domino's and
 * adding a few domino-only classes. Angular's unit-test builder runs spec files with
 * `isolate: false`, so those classes would leak into every later file in the same worker; jsdom
 * then rejects a domino `Event` in `dispatchEvent` (for example the router's `FakeNavigation`).
 * Call `snapshotDomGlobals()` before the render and the returned `restore()` after it. Test-only.
 */
export function snapshotDomGlobals(): () => void {
  const global = globalThis as unknown as Record<string, unknown>;
  const before = new Map<string, unknown>();
  for (const key of Object.getOwnPropertyNames(global)) {
    before.set(key, global[key]);
  }

  return () => {
    for (const key of Object.getOwnPropertyNames(global)) {
      const current = global[key];
      if (typeof current !== 'function') continue; // DOM classes only; leave other globals alone
      if (!before.has(key)) {
        delete global[key]; // a domino-only class such as HTMLParser
      } else if (current !== before.get(key)) {
        global[key] = before.get(key); // vitest's jsdom globals are accessors; assignment restores them
      }
    }
  };
}
