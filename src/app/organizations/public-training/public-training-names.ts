export interface PublicTrainingNames {
  organization: { slug: string; name: string };
  training: { slug: string; name: string };
}

interface Named {
  slug: string;
  name: string;
}

export function publicTrainingNames(source: {
  organization: Named;
  training: Named;
}): PublicTrainingNames {
  const { organization, training } = source;
  return {
    organization: { slug: organization.slug, name: organization.name },
    training: { slug: training.slug, name: training.name },
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
export function readPublicTrainingNames(
  state: unknown,
  route: { orgSlug: string; trainingSlug: string },
): PublicTrainingNames | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const { organization, training } = state as Record<string, unknown>;
  const org = readNamed(organization);
  const named = readNamed(training);
  if (!org || !named) return undefined;
  if (org.slug !== route.orgSlug || named.slug !== route.trainingSlug) return undefined;
  return publicTrainingNames({ organization: org, training: named });
}
