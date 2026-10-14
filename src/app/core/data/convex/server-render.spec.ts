import { ChangeDetectionStrategy, Component, InjectionToken, inject } from '@angular/core';
import {
  bootstrapApplication,
  provideClientHydration,
  type BootstrapContext,
} from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { makeFunctionReference } from 'convex/server';
import {
  CONVEX_HTTP_CLIENT_FACTORY,
  CONVEX_URL,
  injectQuery,
  provideConvex,
  type ConvexHttpClientLike,
} from './index';

import { snapshotDomGlobals } from './testing/dom-globals';

const JSDOM_EVENT = Event;
const JSDOM_NODE = Node;
const JSDOM_NODE_FILTER = NodeFilter; // a function in jsdom; domino's is a plain object

// renderApplication swaps jsdom's DOM classes for domino's on the global; put them back after each test.
let restoreDomGlobals: () => void;
beforeEach(() => {
  restoreDomGlobals = snapshotDomGlobals();
});
afterEach(() => {
  restoreDomGlobals();
});

const listTeams = makeFunctionReference<'query', { leagueId: string }, string[]>('teams:list');
const KEY = 'cvx:teams:list:{"leagueId":"a"}';

@Component({
  selector: 'app-render-probe',
  template: `
    @if (teams.value(); as names) {
      <p class="teams">{{ names.join(', ') }}</p>
    } @else if (teams.error()) {
      <p class="teams">Teams are unavailable right now.</p>
    } @else {
      <p class="teams">Loading teams</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class RenderProbe {
  readonly teams = injectQuery(listTeams, { leagueId: 'a' });
}

function delayedClient(settle: () => Promise<unknown>): ConvexHttpClientLike {
  return {
    query: () =>
      new Promise((resolve, reject) => {
        setTimeout(() => void settle().then(resolve, reject), 25);
      }),
  };
}

function render(client: ConvexHttpClientLike): Promise<string> {
  const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(
      RenderProbe,
      {
        providers: [
          provideServerRendering(),
          provideClientHydration(),
          provideConvex(),
          { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
          { provide: CONVEX_HTTP_CLIENT_FACTORY, useValue: () => client },
        ],
      },
      context,
    );
  return renderApplication(bootstrap, {
    document:
      '<!doctype html><html><head></head><body><app-render-probe></app-render-probe></body></html>',
    url: 'http://localhost/',
    allowedHosts: ['localhost'],
  });
}

function ngState(html: string): Record<string, unknown> {
  const match = /<script id="ng-state" type="application\/json">(.*?)<\/script>/s.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match?.[1] ?? '{}') as Record<string, unknown>;
}

const LEAGUE_ID = new InjectionToken<string>('LEAGUE_ID');

@Component({
  selector: 'app-render-probe',
  template: `<p class="teams">{{ teams.value()?.join(', ') ?? 'Loading teams' }}</p>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class LeagueProbe {
  readonly teams = injectQuery(listTeams, { leagueId: inject(LEAGUE_ID) });
}

describe('concurrent server renders', () => {
  it('keep their own data: no client, cache entry, or TransferState is shared across overlapping renders', async () => {
    const queriesPerClient: unknown[][] = [];
    const factory = vi.fn(() => {
      const seen: unknown[] = [];
      queriesPerClient.push(seen);
      const client: ConvexHttpClientLike = {
        query: ((_fn: unknown, args: { leagueId: string }) => {
          seen.push(args);
          const delay = args.leagueId === 'a' ? 40 : 5;
          return new Promise((resolve) =>
            setTimeout(() => resolve([`team of ${args.leagueId}`]), delay),
          );
        }) as ConvexHttpClientLike['query'],
      };
      return client;
    });

    const renderLeague = (leagueId: string) =>
      renderApplication(
        (context: BootstrapContext) =>
          bootstrapApplication(
            LeagueProbe,
            {
              providers: [
                provideServerRendering(),
                provideClientHydration(),
                provideConvex(),
                { provide: CONVEX_URL, useValue: 'https://happy-otter-123.convex.cloud' },
                { provide: CONVEX_HTTP_CLIENT_FACTORY, useValue: factory },
                { provide: LEAGUE_ID, useValue: leagueId },
              ],
            },
            context,
          ),
        {
          document:
            '<!doctype html><html><head></head><body><app-render-probe></app-render-probe></body></html>',
          url: 'http://localhost/',
          allowedHosts: ['localhost'],
        },
      );

    const [a, b] = await Promise.all([renderLeague('a'), renderLeague('b')]);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(queriesPerClient).toHaveLength(2);
    expect(queriesPerClient.every((seen) => seen.length === 1)).toBe(true);
    expect(a).toContain('<p class="teams">team of a</p>');
    expect(b).toContain('<p class="teams">team of b</p>');
    expect(a).not.toContain('team of b');
    expect(b).not.toContain('team of a');
    expect(ngState(a)).toMatchObject({ [KEY]: { v: ['team of a'] } });
    expect(Object.keys(ngState(a)).filter((k) => k.startsWith('cvx:'))).toEqual([KEY]);
    expect(Object.keys(ngState(b)).filter((k) => k.startsWith('cvx:'))).toEqual([
      'cvx:teams:list:{"leagueId":"b"}',
    ]);
  });
});

describe('server render with renderApplication', () => {
  it('waits for the delayed query: the HTML holds the value and ng-state holds the cvx: key', async () => {
    const html = await render(delayedClient(() => Promise.resolve(['Sharks', 'Jets'])));

    expect(html).toContain('<p class="teams">Sharks, Jets</p>');
    expect(html).not.toContain('Loading teams');
    expect(ngState(html)[KEY]).toEqual({ v: ['Sharks', 'Jets'] });
  });

  it('keeps the real error message out of the HTML and ng-state on failure', async () => {
    const html = await render(
      delayedClient(() =>
        Promise.reject(new Error('connect ECONNREFUSED internal-db.corp.example:443')),
      ),
    );

    expect(html).toContain('Teams are unavailable right now.');
    expect(html).not.toContain('internal-db');
    expect(ngState(html)[KEY]).toEqual({
      e: { name: 'Error', message: 'Convex query failed during server render' },
    });
  });
});

// Runs last in this file, after every render above. Angular's unit-test builder runs spec files
// with `isolate: false`, so whatever this file leaves on the global is what the next file sees.
describe('after the server renders in this file', () => {
  it("leaves jsdom's DOM classes on the global, so later spec files can dispatch events", () => {
    expect(Event).toBe(JSDOM_EVENT);
    expect(Node).toBe(JSDOM_NODE);
    expect(NodeFilter).toBe(JSDOM_NODE_FILTER);
    expect('HTMLParser' in globalThis).toBe(false);
    expect(() => document.createElement('div').dispatchEvent(new Event('probe'))).not.toThrow();
  });
});
