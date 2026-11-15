// The loaded league page and its skeleton share these, so a wrapped name takes the same height in both.

// The row gap keeps a wrapped crumb out of the 24px target circle of the one above it.
export const CRUMB_LIST =
  'flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground';

export const CRUMB_BOX = 'inline-flex items-center rounded-md font-medium pointer-coarse:min-h-11';

export const CRUMB_LINK = `${CRUMB_BOX} hover:underline`;

export const LEAGUE_HEADING =
  'mt-4 text-3xl font-semibold tracking-tight text-balance md:mt-6 md:text-5xl';
