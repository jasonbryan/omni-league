import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { byName, namedParticipants, type NamedParticipant } from './campRegistrants';
import { REGISTRATIONS_OF_ONE_KIND_LIMIT } from './trainingRegistrationReads';

export interface TrainingRegistrant extends NamedParticipant {
  registrationId: Id<'trainingRegistrations'>;
  kind: 'series' | 'class';
  registeredAt: number;
}

/** A cancelled class has no registrants: the series takes no place in it, and cancelling needs none registered. */
export async function trainingClassRegistrantsOf(
  ctx: Pick<QueryCtx, 'db' | 'runQuery'>,
  trainingClass: Doc<'trainingClasses'>,
): Promise<TrainingRegistrant[]> {
  if (trainingClass.status === 'cancelled') return [];
  const { trainingId } = trainingClass;
  const series = await ctx.db
    .query('trainingRegistrations')
    .withIndex('by_trainingId_and_classId', (q) =>
      q.eq('trainingId', trainingId).eq('classId', undefined),
    )
    .take(REGISTRATIONS_OF_ONE_KIND_LIMIT);
  const singles = await ctx.db
    .query('trainingRegistrations')
    .withIndex('by_trainingId_and_classId', (q) =>
      q.eq('trainingId', trainingId).eq('classId', trainingClass._id),
    )
    .take(REGISTRATIONS_OF_ONE_KIND_LIMIT);
  const rows = [...series, ...singles];
  const named = await namedParticipants(ctx, rows);
  return rows
    .map((registration, index): TrainingRegistrant => ({
      registrationId: registration._id,
      kind: registration.classId === undefined ? 'series' : 'class',
      registeredAt: registration.createdAt,
      ...named[index],
    }))
    .sort(byName);
}
