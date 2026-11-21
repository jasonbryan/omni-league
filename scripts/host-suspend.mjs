// A suspended host stops every process, so no timer fires while it sleeps, and at the wake every
// test in flight times out at once. The only sign is a tick interval far longer than the tick. That
// relies on `performance.now()` counting the sleep, as it does on macOS: where the clock stops in
// sleep (Linux), timers stop with it, no test times out, and nothing is reported, which is correct.
export const TICK_MS = 1_000;
export const SUSPEND_GAP_MS = 10_000;

const toSeconds = (ms) => Math.round(ms / 1000);

export function clockTime(epochMs) {
  return new Date(epochMs).toTimeString().slice(0, 8);
}

/**
 * @typedef {{ ms: number, from: number, to: number }} Suspension
 */

/**
 * `awakeNow()` reads the clock itself, so a suspension that no tick has seen yet still counts.
 *
 * @param {{
 *   perfNow?: () => number,
 *   wallNow?: () => number,
 *   setInterval?: (callback: () => void, ms: number) => any,
 *   clearInterval?: (timer: any) => void,
 *   onSuspend?: (suspension: Suspension) => void,
 * }} [options]
 */
export function watchSuspension({
  perfNow = () => performance.now(),
  wallNow = Date.now,
  setInterval: every = setInterval,
  clearInterval: stopEvery = clearInterval,
  onSuspend = () => {},
} = {}) {
  let lastPerf = 0;
  let lastWall = 0;
  let timer;
  let suspendedMs = 0;
  let count = 0;

  const observe = () => {
    const perf = perfNow();
    const wall = wallNow();
    const interval = perf - lastPerf;
    if (interval > TICK_MS + SUSPEND_GAP_MS) {
      const ms = interval - TICK_MS;
      suspendedMs += ms;
      count += 1;
      onSuspend({ ms, from: lastWall, to: wall });
    }
    lastPerf = perf;
    lastWall = wall;
    return perf;
  };

  return {
    start() {
      lastPerf = perfNow();
      lastWall = wallNow();
      timer = every(observe, TICK_MS);
      timer?.unref?.();
    },
    stop() {
      stopEvery(timer);
      observe();
      return { count, ms: suspendedMs };
    },
    awakeNow: () => observe() - suspendedMs,
    suspendedMs: () => {
      observe();
      return suspendedMs;
    },
  };
}

/**
 * @template T
 * @param {() => Promise<T>} run
 * @param {Parameters<typeof watchSuspension>[0] & { error?: (line: string) => void }} [options]
 */
export async function reportSuspensions(run, { error = console.error, ...clocks } = {}) {
  const watch = watchSuspension({
    ...clocks,
    onSuspend: ({ ms, from, to }) =>
      error(
        `e2e: the host was suspended for ${toSeconds(ms)} s (${clockTime(from)} to ${clockTime(to)}, ` +
          'from Date.now()) during the playwright step; tests running then time out',
      ),
  });
  watch.start();
  try {
    return await run();
  } finally {
    const { count, ms } = watch.stop();
    if (count > 0) {
      error(
        `e2e: the host was suspended ${count} ${count === 1 ? 'time' : 'times'} (${toSeconds(ms)} s ` +
          'in all) during the playwright step; rerun the failures with the host awake',
      );
    }
  }
}
