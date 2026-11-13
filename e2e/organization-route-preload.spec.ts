import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCAL_BUILD_ONLY, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { dateFromToday, seedSeasons, seedTenant } from './support/tenant';
import { seedTournament } from './support/tournament';

test.skip(remoteBaseUrl !== undefined, LOCAL_BUILD_ONLY);

/** Angular's cap on the `modulepreload` links of one page. */
const MAX_PRELOAD_LINKS = 10;
const SERVER_DIST = join(process.cwd(), 'dist', 'omni-league', 'server');
const BROWSER_DIST = join(process.cwd(), 'dist', 'omni-league', 'browser');

interface ManifestRoute {
  route: string;
  preload?: string[];
}

async function manifestRoutes(): Promise<ManifestRoute[]> {
  const url = pathToFileURL(join(SERVER_DIST, 'angular-app-manifest.mjs')).href;
  const { default: manifest } = (await import(url)) as { default: { routes: ManifestRoute[] } };
  return manifest.routes;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function preloadLinks(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*>/g)].map(
    ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '',
  );
}

const COURTS = { name: 'Sand Courts', address: '1 Beach Rd, Corpus Christi, TX 78401' };
const LEAGUE_SLUG = 'coed-league';
const SEASON_SLUG = 'summer-2027';
const TOURNAMENT_SLUG = 'beach-open';

interface PublicPage {
  name: string;
  manifestRoute: string;
  pageClass: string;
  path: (organization: string) => string;
}

const PUBLIC_PAGES: PublicPage[] = [
  {
    name: 'organization page',
    manifestRoute: '/organizations/*',
    pageClass: 'OrganizationPage',
    path: (organization) => organization,
  },
  {
    name: 'sport view',
    manifestRoute: '/organizations/*/sports/*',
    pageClass: 'OrganizationPage',
    path: (organization) => `${organization}/sports/beach-volleyball`,
  },
  {
    name: 'league page',
    manifestRoute: '/organizations/*/leagues/*',
    pageClass: 'PublicLeaguePage',
    path: (organization) => `${organization}/leagues/${LEAGUE_SLUG}`,
  },
  {
    name: 'season page',
    manifestRoute: '/organizations/*/leagues/*/seasons/*',
    pageClass: 'PublicSeasonPage',
    path: (organization) => `${organization}/leagues/${LEAGUE_SLUG}/seasons/${SEASON_SLUG}`,
  },
  {
    name: 'tournament page',
    manifestRoute: '/organizations/*/tournaments/*',
    pageClass: 'PublicTournamentPage',
    path: (organization) => `${organization}/tournaments/${TOURNAMENT_SLUG}`,
  },
];

async function seedPublicPages(): Promise<string> {
  const tenant = await seedTenant({
    name: 'E2E Preload',
    locations: [COURTS],
    leagues: [{ name: 'Coed League', sport: 'beachVolleyball', locations: [COURTS.name] }],
  });
  await seedSeasons(tenant, LEAGUE_SLUG, [
    { name: 'Summer 2027', slug: SEASON_SLUG, startDate: '2027-06-06', endDate: '2027-08-29' },
  ]);
  await seedTournament(tenant, {
    name: 'Beach Open',
    slug: TOURNAMENT_SLUG,
    locations: [COURTS.name],
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
  });
  return tenant.path;
}

test.describe('public organization pages: modulepreload links', () => {
  for (const { name, manifestRoute, pageClass, path } of PUBLIC_PAGES) {
    test(
      `${name}: at most ${MAX_PRELOAD_LINKS} links, the manifest list, the route file's chunk first and the page's own chunk second`,
      RAW_HTTP,
      async ({ request }) => {
        const organization = await seedPublicPages();
        const response = await fetchRawHtml(request, path(organization));
        expect(response.status).toBe(200);

        const manifest = (await manifestRoutes()).find((entry) => entry.route === manifestRoute);
        const expected = manifest?.preload ?? [];
        expect(expected.length, manifestRoute).toBeGreaterThan(0);
        const links = preloadLinks(response.html);
        expect(links.length).toBeLessThanOrEqual(MAX_PRELOAD_LINKS);
        expect(links).toEqual(expected);

        const [routeChunk = '', pageChunk = ''] = links;
        const routeFile = readFileSync(join(BROWSER_DIST, routeChunk), 'utf8');
        expect(routeFile).toContain('organizationRoutes');
        expect(routeFile).toMatch(
          new RegExp(
            `import\\(\\s*["'\`]\\./${escaped(pageChunk)}["'\`]\\s*\\)[\\s\\S]{0,60}\\b${pageClass}\\b`,
          ),
        );
      },
    );
  }

  test(
    'the bare /organizations path preloads the route file and the not-found page, as the manifest lists',
    RAW_HTTP,
    async ({ request }) => {
      const response = await fetchRawHtml(request, '/organizations');
      expect(response.status).toBe(404);
      const manifest = (await manifestRoutes()).find((entry) => entry.route === '/organizations');
      expect(manifest?.preload?.length).toBeGreaterThan(0);
      const links = preloadLinks(response.html);
      expect(links.length).toBeLessThanOrEqual(MAX_PRELOAD_LINKS);
      expect(links).toEqual(manifest?.preload);
    },
  );
});
