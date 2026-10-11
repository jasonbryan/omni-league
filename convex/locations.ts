import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireLocationAdmin, requireOrgAdmin } from './lib/access';
import {
  checkLocationAddress,
  checkLocationName,
  type LocationInputError,
} from './lib/locationInput';
import { insertLocation, updateLocation } from './lib/tenantWrites';

/**
 * Locations `listForAdmin` returns at most. The admin list is one page with no paging (#65), and
 * the public list reaches 200 rows too (`PUBLIC_LIST_MAX_PAGE`). Never taken from args.
 */
export const ADMIN_LOCATIONS_LIMIT = 200;

function refuse(error: LocationInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

/** The trimmed name and address to store, or the refusal about the first invalid field. */
function checkedInput(name: string, address: string): { name: string; address: string } {
  const checkedName = checkLocationName(name);
  if (!checkedName.ok) refuse(checkedName.error);
  const checkedAddress = checkLocationAddress(address);
  if (!checkedAddress.ok) refuse(checkedAddress.error);
  return { name: checkedName.value, address: checkedAddress.value };
}

/**
 * The organization's locations for its admin area (#65): `{ locationId, name, address }` sorted by
 * name ignoring case, at most `ADMIN_LOCATIONS_LIMIT`. Org admins of the organization only
 * (`requireOrgAdmin`); every other caller is refused.
 */
export const listForAdmin = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({ locationId: v.id('locations'), name: v.string(), address: v.string() }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const locations = await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_sortName', (q) => q.eq('organizationId', organizationId))
      .take(ADMIN_LOCATIONS_LIMIT);
    return locations.map(({ _id, name, address }) => ({ locationId: _id, name, address }));
  },
});

/**
 * Adds a location to the organization (#65). Org admins of the organization only. The name and
 * address are trimmed and must be 1 to 100 and 1 to 200 characters (`convex/lib/locationInput.ts`,
 * the rules and messages the form checks too); a refusal about a field is a `ConvexError` whose
 * data is the `LocationInputError`, and nothing is written. The row is inserted through
 * `tenantWrites`, which sets its `sortName` and adds 1 to the organization's `locationCount`.
 */
export const create = mutation({
  args: { organizationId: v.id('organizations'), name: v.string(), address: v.string() },
  returns: v.object({ locationId: v.id('locations') }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const input = checkedInput(args.name, args.address);
    const locationId = await insertLocation(ctx, args.organizationId, input);
    return { locationId };
  },
});

/**
 * Changes a location's name and address (#65). Org admins of the location's organization only:
 * the organization comes from the stored location, never from `args`, so an id of another
 * organization's location is refused. Validation is as for `create`. The change goes through
 * `tenantWrites`, which sets the new `sortName`.
 */
export const update = mutation({
  args: { locationId: v.id('locations'), name: v.string(), address: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { location } = await requireLocationAdmin(ctx, args.locationId);
    const input = checkedInput(args.name, args.address);
    await updateLocation(ctx, location, input);
    return null;
  },
});
