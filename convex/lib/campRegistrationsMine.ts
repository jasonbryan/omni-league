import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { today } from './campPublicList';
import { positionIn, waitingEntriesOf } from './campWaitlistWrites';
import { participantValidator } from './individualRegistration';
import {
  MINE_ROWS_LIMIT,
  MINE_SCAN_LIMIT,
  lookupOnce,
  publishedProgramSummary,
} from './myRegistrations';

export const campMineRowValidator = v.object({
  /** The id of the registration or of the waiting entry, so each row of a list has its own key. */
  rowId: v.string(),
  status: v.union(v.literal('registered'), v.literal('waiting')),
  /** Set on a waiting row. */
  position: v.optional(v.number()),
  participant: participantValidator,
  organizationName: v.string(),
  organizationSlug: v.string(),
  campName: v.string(),
  campSlug: v.string(),
  sessionName: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  dailyStartTime: v.optional(v.string()),
  dailyEndTime: v.optional(v.string()),
  locations: v.array(v.string()),
});

export type CampMineRow = Infer<typeof campMineRowValidator>;

type Held = Pick<
  Doc<'campRegistrations'> | Doc<'campWaitlistEntries'>,
  '_id' | '_creationTime' | 'sessionId' | 'participant'
>;

/** The caller's own upcoming camp rows, the soonest first: places they hold, and places they wait for. */
export async function campRowsOf(
  ctx: Pick<QueryCtx, 'db'>,
  userId: Id<'users'>,
): Promise<CampMineRow[]> {
  const registrations = await ctx.db
    .query('campRegistrations')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .order('desc')
    .take(MINE_SCAN_LIMIT);
  const entries = (
    await ctx.db
      .query('campWaitlistEntries')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(MINE_SCAN_LIMIT)
  ).filter((entry) => entry.status === 'waiting');

  const todayDate = today();
  const sessionOf = lookupOnce((id: Id<'campSessions'>) => ctx.db.get('campSessions', id));
  const waitingIn = lookupOnce(async (id: Id<'campSessions'>) => waitingEntriesOf(ctx, id));
  const campOf = lookupOnce(async (id: Id<'camps'>) => {
    const camp = await ctx.db.get('camps', id);
    const summary =
      camp && (await publishedProgramSummary(ctx, camp.programId, camp.organizationId));
    return summary ?? null;
  });

  const rows: { creation: number; row: CampMineRow }[] = [];
  const add = async (
    held: Held,
    status: CampMineRow['status'],
    positionOf?: (sessionId: Id<'campSessions'>) => Promise<number>,
  ) => {
    const session = await sessionOf(held.sessionId);
    if (!session || session.endDate < todayDate) return;
    const camp = await campOf(session.campId);
    if (!camp) return;
    const position = await positionOf?.(session._id);
    rows.push({
      creation: held._creationTime,
      row: {
        rowId: held._id,
        status,
        ...(position !== undefined && { position }),
        participant: held.participant,
        organizationName: camp.organizationName,
        organizationSlug: camp.organizationSlug,
        campName: camp.programName,
        campSlug: camp.programSlug,
        sessionName: session.name,
        startDate: session.startDate,
        endDate: session.endDate,
        ...(session.dailyStartTime !== undefined && { dailyStartTime: session.dailyStartTime }),
        ...(session.dailyEndTime !== undefined && { dailyEndTime: session.dailyEndTime }),
        locations: camp.locations,
      },
    });
  };
  for (const registration of registrations) await add(registration, 'registered');
  for (const entry of entries) {
    await add(entry, 'waiting', async (sessionId) =>
      positionIn((await waitingIn(sessionId)) ?? [], entry._id),
    );
  }

  return rows
    .sort((a, b) => a.row.startDate.localeCompare(b.row.startDate) || a.creation - b.creation)
    .slice(0, MINE_ROWS_LIMIT)
    .map(({ row }) => row);
}
