import { v, type Infer } from 'convex/values';

// Imports only `convex/values`, so the app can import it to check saved copies without bundling the server functions.
// Holds no ids and no registrant data: the page is cached and saved offline. `placesLeft` is a count, never the registrations behind it.
// Changing a field changes what the app accepts as a saved copy.
const publicCampSessionValidator = v.object({
  name: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  dailyStartTime: v.optional(v.string()),
  dailyEndTime: v.optional(v.string()),
  placesLeft: v.number(),
  registrationDeadline: v.string(),
});

export const publicCampPageValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  minimumAge: v.number(),
  maximumAge: v.number(),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  sessions: v.array(publicCampSessionValidator),
});

export type PublicCampPage = Infer<typeof publicCampPageValidator>;

export const getCampPublicPageReturns = v.union(v.null(), publicCampPageValidator);
