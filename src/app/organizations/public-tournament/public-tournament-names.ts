export interface PublicTournamentNames {
  organization: { slug: string; name: string };
  tournament: { slug: string; name: string };
}

interface Named {
  slug: string;
  name: string;
}

export function publicTournamentNames(source: {
  organization: Named;
  tournament: Named;
}): PublicTournamentNames {
  const { organization, tournament } = source;
  return {
    organization: { slug: organization.slug, name: organization.name },
    tournament: { slug: tournament.slug, name: tournament.name },
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
export function readPublicTournamentNames(
  state: unknown,
  route: { orgSlug: string; tournamentSlug: string },
): PublicTournamentNames | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const { organization, tournament } = state as Record<string, unknown>;
  const org = readNamed(organization);
  const named = readNamed(tournament);
  if (!org || !named) return undefined;
  if (org.slug !== route.orgSlug || named.slug !== route.tournamentSlug) return undefined;
  return publicTournamentNames({ organization: org, tournament: named });
}
