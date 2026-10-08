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
      const previous = before.get(key);
      // DOM classes only; leave other globals alone. Check both values: domino's `NodeFilter` is a
      // plain object replacing jsdom's function, and it must be restored too.
      if (typeof current !== 'function' && typeof previous !== 'function') continue;
      if (!before.has(key)) {
        delete global[key]; // a domino-only class such as HTMLParser
      } else if (current !== previous) {
        global[key] = previous; // vitest's jsdom globals are accessors; assignment restores them
      }
    }
  };
}
