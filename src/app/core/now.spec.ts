import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { injectNow } from './now';

@Component({
  selector: 'app-now-probe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ now() }}`,
})
class NowProbe {
  readonly now = injectNow();
}

const BEFORE_DATE_CHANGE = Date.UTC(2027, 4, 19, 11, 59);
const AFTER_DATE_CHANGE = BEFORE_DATE_CHANGE + 60_000;

describe('injectNow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(BEFORE_DATE_CHANGE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at the current time', () => {
    const fixture = TestBed.createComponent(NowProbe);
    expect(fixture.componentInstance.now()).toBe(BEFORE_DATE_CHANGE);
  });

  it('reads the browser clock again after the first render, since the server HTML may be older', async () => {
    const fixture = TestBed.createComponent(NowProbe);
    vi.setSystemTime(BEFORE_DATE_CHANGE + 5_000);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.now()).toBe(BEFORE_DATE_CHANGE + 5_000);
  });

  it('updates when the date at UTC-12 changes, with no event from the page', async () => {
    const fixture = TestBed.createComponent(NowProbe);
    fixture.detectChanges();
    await fixture.whenStable();
    vi.advanceTimersByTime(60_000);
    expect(fixture.componentInstance.now()).toBe(AFTER_DATE_CHANGE);
  });

  it('keeps updating on each later date change', async () => {
    const fixture = TestBed.createComponent(NowProbe);
    fixture.detectChanges();
    await fixture.whenStable();
    const day = 24 * 60 * 60 * 1000;
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(day);
    expect(fixture.componentInstance.now()).toBe(AFTER_DATE_CHANGE + day);
  });

  it('stops its timer when the component is destroyed', async () => {
    const fixture = TestBed.createComponent(NowProbe);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(vi.getTimerCount()).toBe(1);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
