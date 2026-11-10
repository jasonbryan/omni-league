import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { makeFunctionReference } from 'convex/server';
import { CONVEX_CLIENT } from '../data/convex';
import { FakeConvexClient } from '../data/convex/testing/fake-convex-client';
import { AVAILABILITY_PAUSE_MS, injectSlugAvailability } from './slug-availability';

const isSlugAvailable = makeFunctionReference<'query', { leagueId: string; slug: string }, boolean>(
  'seasons:isSlugAvailable',
);

const slug = signal('');
const scope = signal<{ leagueId: string } | null>({ leagueId: 'league-1' });

@Component({
  selector: 'app-availability-host',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly availability = injectSlugAvailability({
    query: isSlugAvailable,
    slug: () => slug(),
    scope: () => scope(),
  });
}

describe('injectSlugAvailability', () => {
  let client: FakeConvexClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new FakeConvexClient();
    slug.set('');
    scope.set({ leagueId: 'league-1' });
    TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
  });

  afterEach(() => vi.useRealTimers());

  function open() {
    const fixture = TestBed.createComponent(Host);
    TestBed.tick();
    return fixture.componentInstance.availability;
  }

  function type(value: string) {
    slug.set(value);
    TestBed.tick();
  }

  function pause() {
    vi.advanceTimersByTime(AVAILABILITY_PAUSE_MS);
    TestBed.tick();
  }

  const latest = () => client.activeSubscriptions.at(-1);

  it('asks nothing while the user is typing, then asks once after the pause', () => {
    open();
    type('fall-2026');
    vi.advanceTimersByTime(AVAILABILITY_PAUSE_MS - 1);
    TestBed.tick();
    expect(client.subscriptions).toHaveLength(0);

    pause();
    expect(client.subscriptions).toHaveLength(1);
    expect(client.subscriptions[0]).toMatchObject({
      name: 'seasons:isSlugAvailable',
      args: { leagueId: 'league-1', slug: 'fall-2026' },
    });
  });

  it('restarts the pause on each keystroke', () => {
    open();
    type('fall-2026');
    vi.advanceTimersByTime(AVAILABILITY_PAUSE_MS - 100);
    type('fall-2027');
    vi.advanceTimersByTime(AVAILABILITY_PAUSE_MS - 100);
    TestBed.tick();
    expect(client.subscriptions).toHaveLength(0);

    pause();
    expect(client.subscriptions).toHaveLength(1);
    expect(client.subscriptions[0].args).toMatchObject({ slug: 'fall-2027' });
  });

  it('asks at once when the user leaves the field', () => {
    const availability = open();
    type('fall-2026');
    availability.left();
    TestBed.tick();
    expect(client.subscriptions).toHaveLength(1);
  });

  it('answers available and taken', () => {
    const availability = open();
    type('fall-2026');
    pause();
    expect(availability.answer()).toBeNull();

    latest()!.emit(true);
    expect(availability.answer()).toBe('available');

    type('fall-2027');
    pause();
    latest()!.emit(false);
    expect(availability.answer()).toBe('taken');
  });

  it('sends no query for a value that fails the format rule or is reserved', () => {
    const availability = open();
    for (const value of ['', 'ab', 'Bad-Slug', 'a--b', 'new']) {
      type(value);
      pause();
      availability.left();
      TestBed.tick();
    }
    expect(client.subscriptions).toHaveLength(0);
    expect(availability.answer()).toBeNull();
  });

  it('sends no query while the scope is unknown', () => {
    scope.set(null);
    const availability = open();
    type('fall-2026');
    availability.left();
    pause();
    expect(client.subscriptions).toHaveLength(0);
  });

  it('never shows the answer for a value the field no longer holds', () => {
    const availability = open();
    type('abc');
    pause();
    const first = latest()!;

    type('abcd');
    first.emit(false);
    expect(availability.answer()).toBeNull();

    pause();
    expect(availability.answer()).toBeNull();
    latest()!.emit(true);
    expect(availability.answer()).toBe('available');
  });

  it('drops the answer for an earlier value that arrives after the later one', () => {
    const availability = open();
    type('abc');
    pause();
    const first = latest()!;
    type('abcd');
    pause();
    latest()!.emit(true);
    first.emit(false);
    expect(availability.answer()).toBe('available');
  });

  it('shows no answer after the value changes again until the next one arrives', () => {
    const availability = open();
    type('abc');
    pause();
    latest()!.emit(false);
    expect(availability.answer()).toBe('taken');

    type('abcd');
    expect(availability.answer()).toBeNull();
  });

  it('shows no answer when the query failed', () => {
    const availability = open();
    type('abc');
    pause();
    latest()!.fail(new Error('offline'));
    expect(availability.answer()).toBeNull();
  });
});
