// Test doubles for scripts/host-suspend.mjs: both clocks and the interval, moved by hand.
export const at = (hour, minute, second) => new Date(2026, 10, 20, hour, minute, second).getTime();

const START_PERF_MS = 5_000;

/** The wall clock starts at 01:40:44. */
export function fakeHost() {
  let perf = START_PERF_MS;
  let wall = at(1, 40, 44);
  let tick;
  return {
    clocks: {
      perfNow: () => perf,
      wallNow: () => wall,
      setInterval: (callback) => {
        tick = callback;
        return { unref() {} };
      },
      clearInterval: () => {
        tick = undefined;
      },
    },
    /** Time passes and the tick fires once at the end. */
    elapse(ms) {
      this.jump(ms);
      tick?.();
    },
    /** Time passes and no tick fires. */
    jump(ms) {
      perf += ms;
      wall += ms;
    },
    /** The wall clock alone moves, as in a clock change, and the tick fires. */
    stepWallClock(ms) {
      wall += ms;
      tick?.();
    },
    get elapsedMs() {
      return perf - START_PERF_MS;
    },
    get ticking() {
      return tick !== undefined;
    },
  };
}
