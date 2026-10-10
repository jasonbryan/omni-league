import { v, type Infer } from 'convex/values';

// The result of organizations:getPublicPage (#60). It lives apart from organizations.ts and imports
// only `convex/values`, so the Angular app can import the same validator to check saved copies
// (ADR 0013 section 3, #82: `src/app/core/data/convex/offline-saved-queries.ts`) without bundling
// the server function. Changing it changes what the app accepts as a saved copy.

/** Everything the public organization page shows, and nothing else (no ids, staff, or payments). */
export const publicPageValidator = v.object({
  name: v.string(),
  slug: v.string(),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  leagues: v.array(
    v.object({
      name: v.string(),
      sportName: v.string(),
      locationNames: v.array(v.string()),
    }),
  ),
});

export type PublicPage = Infer<typeof publicPageValidator>;

/** The `returns` validator of `organizations:getPublicPage`: the page, or `null` when none. */
export const getPublicPageReturns = v.union(v.null(), publicPageValidator);
