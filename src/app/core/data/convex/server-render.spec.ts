import { ChangeDetectionStrategy, Component } from '@angular/core';
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

const listTeams = makeFunctionReference<'query', { leagueId: string }, string[]>('teams:list');
const KEY = 'cvx:teams:list:{"leagueId":"a"}';

/**
 * Spec-only component following the README "Server rendering" rules: it branches on the error and
 * shows its own wording, never `error().message`.
 */
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

/** A fake HTTP client that settles after a real delay, so the render must wait for it. */
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
