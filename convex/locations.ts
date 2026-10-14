import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireLocationAdmin, requireOrgAdmin } from './lib/access';
import {
  checkLocationAddress,
  checkLocationName,
  type LocationInputError,
} from './lib/locationInput';
import { insertLocation, updateLocation } from './lib/tenantWrites';

export const ADMIN_LOCATIONS_LIMIT = 200;

function refuse(error: LocationInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

function checkedInput(name: string, address: string): { name: string; address: string } {
  const checkedName = checkLocationName(name);
  if (!checkedName.ok) refuse(checkedName.error);
  const checkedAddress = checkLocationAddress(address);
  if (!checkedAddress.ok) refuse(checkedAddress.error);
  return { name: checkedName.value, address: checkedAddress.value };
}

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
