export interface PublicCampNames {
  organization: { slug: string; name: string };
  camp: { slug: string; name: string };
}

interface Named {
  slug: string;
  name: string;
}

export function publicCampNames(source: { organization: Named; camp: Named }): PublicCampNames {
  const { organization, camp } = source;
  return {
    organization: { slug: organization.slug, name: organization.name },
    camp: { slug: camp.slug, name: camp.name },
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
export function readPublicCampNames(
  state: unknown,
  route: { orgSlug: string; campSlug: string },
): PublicCampNames | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const { organization, camp } = state as Record<string, unknown>;
  const org = readNamed(organization);
  const named = readNamed(camp);
  if (!org || !named) return undefined;
  if (org.slug !== route.orgSlug || named.slug !== route.campSlug) return undefined;
  return publicCampNames({ organization: org, camp: named });
}
