import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { injectNowAtDeadlines, MAX_TIMER_DELAY_MS } from './now-at-deadlines';

const START = Date.UTC(2026, 10, 4, 12, 0, 0);
const MINUTE = 60_000;

@Component({
  selector: 'app-now-at-deadlines-probe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ now() }}`,
})
class Probe {
  readonly deadlines = signal<number[]>([]);
  readonly now = injectNowAtDeadlines(() => this.deadlines());
}

describe('injectNowAtDeadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function open(deadlines: number[]) {
    const fixture = TestBed.createComponent(Probe);
    fixture.componentInstance.deadlines.set(deadlines);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('starts at the current time and sets no timer while there is no deadline', async () => {
    const fixture = await open([]);
    expect(fixture.componentInstance.now()).toBe(START);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads the clock again when the earliest future deadline passes', async () => {
    const fixture = await open([START + 5 * MINUTE, START + MINUTE]);
    vi.advanceTimersByTime(MINUTE - 1);
    expect(fixture.componentInstance.now()).toBe(START);
    vi.advanceTimersByTime(1);
    expect(fixture.componentInstance.now()).toBe(START + MINUTE);
  });

  it('waits for the next deadline after one passes, and then for none', async () => {
    const fixture = await open([START + MINUTE, START + 5 * MINUTE]);
    vi.advanceTimersByTime(MINUTE);
    await fixture.whenStable();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(4 * MINUTE);
    await fixture.whenStable();
    expect(fixture.componentInstance.now()).toBe(START + 5 * MINUTE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a deadline already passed', async () => {
    const fixture = await open([START - MINUTE, START]);
    expect(vi.getTimerCount()).toBe(0);
    expect(fixture.componentInstance.now()).toBe(START);
  });

  it('follows a deadline that changes', async () => {
    const fixture = await open([START + 10 * MINUTE]);
    fixture.componentInstance.deadlines.set([START + MINUTE]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(MINUTE);
    expect(fixture.componentInstance.now()).toBe(START + MINUTE);
  });

  it('waits in steps for a deadline past the longest delay a timer takes', async () => {
    const far = START + MAX_TIMER_DELAY_MS + MINUTE;
    const fixture = await open([far]);
    vi.advanceTimersByTime(MAX_TIMER_DELAY_MS);
    await fixture.whenStable();
    expect(fixture.componentInstance.now()).toBe(START + MAX_TIMER_DELAY_MS);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(MINUTE);
    expect(fixture.componentInstance.now()).toBe(far);
  });

  it('stops its timer when the component is destroyed', async () => {
    const fixture = await open([START + MINUTE]);
    expect(vi.getTimerCount()).toBe(1);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
