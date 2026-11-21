export const at = (hour, minute, second) => new Date(2026, 10, 20, hour, minute, second).getTime();

const START_PERF_MS = 5_000;

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
    elapse(ms) {
      this.jump(ms);
      tick?.();
    },
    jump(ms) {
      perf += ms;
      wall += ms;
    },
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
