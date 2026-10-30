import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/** Spread into a result: the logo's URL, or nothing when the organization has none or its file is gone. */
export async function logoUrlField(
  ctx: Pick<QueryCtx, 'storage'>,
  organization: Pick<Doc<'organizations'>, 'logoStorageId'>,
): Promise<{ logoUrl?: string }> {
  if (organization.logoStorageId === undefined) return {};
  const logoUrl = await ctx.storage.getUrl(organization.logoStorageId);
  return logoUrl === null ? {} : { logoUrl };
}
