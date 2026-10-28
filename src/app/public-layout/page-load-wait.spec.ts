import { PLATFORM_ID, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PAGE_LOAD_WAIT_MS, injectPageLoadWait } from './page-load-wait';

const waiting = signal(false);
const key = signal('a');

function start(platform: 'browser' | 'server' = 'browser'): Signal<boolean> {
  TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
  const stalled = TestBed.runInInjectionContext(() => injectPageLoadWait(waiting, key));
  TestBed.tick();
  return stalled;
}

function elapse(ms: number): void {
  vi.advanceTimersByTime(ms);
  TestBed.tick();
}

describe('injectPageLoadWait', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    waiting.set(true);
    key.set('a');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits ten seconds', () => {
    expect(PAGE_LOAD_WAIT_MS).toBe(10_000);
  });

  it('is stalled once the wait has passed while waiting', () => {
    const stalled = start();
    elapse(PAGE_LOAD_WAIT_MS - 1);
    expect(stalled()).toBe(false);
    elapse(1);
    expect(stalled()).toBe(true);
  });

  it('never stalls when the answer arrives first', () => {
    const stalled = start();
    elapse(PAGE_LOAD_WAIT_MS - 1);
    waiting.set(false);
    TestBed.tick();
    elapse(PAGE_LOAD_WAIT_MS * 2);
    expect(stalled()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops being stalled when the answer arrives', () => {
    const stalled = start();
    elapse(PAGE_LOAD_WAIT_MS);
    expect(stalled()).toBe(true);
    waiting.set(false);
    expect(stalled()).toBe(false);
  });

  it('starts the wait over when the key changes', () => {
    const stalled = start();
    elapse(PAGE_LOAD_WAIT_MS - 1);
    key.set('b');
    TestBed.tick();
    elapse(PAGE_LOAD_WAIT_MS - 1);
    expect(stalled()).toBe(false);
    elapse(1);
    expect(stalled()).toBe(true);
  });

  it('starts the wait over for a new key while stalled', () => {
    const stalled = start();
    elapse(PAGE_LOAD_WAIT_MS);
    key.set('b');
    expect(stalled()).toBe(false);
    TestBed.tick();
    elapse(PAGE_LOAD_WAIT_MS);
    expect(stalled()).toBe(true);
  });

  it('does not restart for a change that leaves the key as it was', () => {
    const stalled = start();
    elapse(PAGE_LOAD_WAIT_MS - 1);
    key.set('a');
    TestBed.tick();
    elapse(1);
    expect(stalled()).toBe(true);
  });

  it('runs no timer while not waiting, and starts one when waiting begins', () => {
    waiting.set(false);
    const stalled = start();
    elapse(PAGE_LOAD_WAIT_MS * 2);
    expect(stalled()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    waiting.set(true);
    TestBed.tick();
    elapse(PAGE_LOAD_WAIT_MS);
    expect(stalled()).toBe(true);
  });

  it('starts over when waiting stops and begins again', () => {
    const stalled = start();
    elapse(PAGE_LOAD_WAIT_MS);
    waiting.set(false);
    TestBed.tick();
    elapse(PAGE_LOAD_WAIT_MS - 1);
    waiting.set(true);
    TestBed.tick();
    expect(stalled()).toBe(false);
    elapse(PAGE_LOAD_WAIT_MS - 1);
    expect(stalled()).toBe(false);
    elapse(1);
    expect(stalled()).toBe(true);
  });

  it('starts no timer on the server', () => {
    const stalled = start('server');
    expect(vi.getTimerCount()).toBe(0);
    elapse(PAGE_LOAD_WAIT_MS * 2);
    expect(stalled()).toBe(false);
  });

  it('clears its timer when the page is destroyed', () => {
    start();
    expect(vi.getTimerCount()).toBe(1);
    TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0);
  });
});
