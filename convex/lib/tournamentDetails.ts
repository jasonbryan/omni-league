import { v } from 'convex/values';

// Imports only `convex/values`, so the app can import it with the public page validators.
export const tournamentDetailsValidator = v.object({
  organization: v.object({ name: v.string(), slug: v.string() }),
  name: v.string(),
  slug: v.string(),
  sportName: v.string(),
  divisionLabel: v.string(),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  startDate: v.string(),
  endDate: v.string(),
  registrationDeadline: v.string(),
  minimumRosterSize: v.number(),
  maximumTeams: v.number(),
});
