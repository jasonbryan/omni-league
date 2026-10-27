const LEAD = 'Players on each side, and so the minimum roster size.';
const NAMED_SEASONS = 3;

interface SeasonFormat {
  name: string;
  formatName: string;
  startDate: string;
  status: string;
}

/** Earliest first. */
export function publishedSeasons(seasons: readonly SeasonFormat[]): SeasonFormat[] {
  return seasons
    .filter((season) => season.status === 'published')
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}

/** A draft season follows a format change and a published season keeps its own, so the hint names the published ones and the format they hold. */
export function formatHint(
  published: readonly Pick<SeasonFormat, 'name' | 'formatName'>[],
): string {
  const applies = 'A change applies to new seasons';
  if (published.length === 0) return `${LEAD} ${applies}.`;
  const named = published.slice(0, NAMED_SEASONS).map((season) => season.name);
  const rest = published.length - named.length;
  const list = rest > 0 ? [...named, `${rest} more`] : named;
  const last = list.pop()!;
  const subject = list.length === 0 ? last : `${list.join(', ')} and ${last}`;
  const formats = new Set(published.map((season) => season.formatName));
  const [only] = formats;
  const held = formats.size === 1 ? only : 'their own formats';
  const verb = published.length === 1 ? 'keeps' : 'keep';
  return `${LEAD} ${applies}; ${subject} ${verb} ${held}.`;
}
