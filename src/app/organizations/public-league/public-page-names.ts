export interface PublicPageNames {
  organization: { slug: string; name: string };
  league: { slug: string; name: string; sportName: string };
  season?: { slug: string; name: string };
}

interface Named {
  slug: string;
  name: string;
}

export function publicPageNames(source: {
  organization: Named;
  league: Named & { sportName: string };
  season?: Named;
}): PublicPageNames {
  const { organization, league, season } = source;
  return {
    organization: { slug: organization.slug, name: organization.name },
    league: { slug: league.slug, name: league.name, sportName: league.sportName },
    ...(season ? { season: { slug: season.slug, name: season.name } } : {}),
  };
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function readNamed(value: unknown): Named | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { slug, name } = value as Record<string, unknown>;
  return isText(slug) && isText(name) ? { slug, name } : undefined;
}

/**
 * Navigation state is whatever the history entry holds, so the names are used only when each field is
 * text and the slugs are the route's: a stale or edited entry falls back to the plain skeleton.
 */
export function readPublicPageNames(
  state: unknown,
  route: { orgSlug: string; leagueSlug: string; seasonSlug?: string },
): PublicPageNames | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const { organization, league, season } = state as Record<string, unknown>;
  const org = readNamed(organization);
  const lg = readNamed(league);
  if (!org || !lg) return undefined;
  const { sportName } = league as { sportName?: unknown };
  if (!isText(sportName)) return undefined;
  if (org.slug !== route.orgSlug || lg.slug !== route.leagueSlug) return undefined;
  const names = { organization: org, league: { ...lg, sportName } };
  if (season === undefined && route.seasonSlug === undefined) return publicPageNames(names);
  const seasonNames = readNamed(season);
  if (!seasonNames || (route.seasonSlug !== undefined && seasonNames.slug !== route.seasonSlug)) {
    return undefined;
  }
  return publicPageNames({ ...names, season: seasonNames });
}
