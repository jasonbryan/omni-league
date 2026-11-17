import { defineSchema, defineTable, type TableDefinition } from 'convex/server';
import { v } from 'convex/values';
import schema from './schema';

type ObjectTable = TableDefinition<ReturnType<typeof v.object>>;

function widen(
  table: ObjectTable,
  fields: Record<string, ReturnType<typeof v.string>>,
): ObjectTable {
  let widened: ObjectTable = defineTable(v.object({ ...table.validator.fields, ...fields }));
  for (const { indexDescriptor, fields: indexed } of table[' indexes']()) {
    widened = widened.index(indexDescriptor, indexed as [string, ...string[]]);
  }
  return widened;
}

/**
 * The tournament shapes of the release that adds double elimination, which the code of the release before it has to run on:
 * a `double` bracket type, a grand final setting, and the games of a losers' bracket and a grand final.
 */
export default defineSchema({
  ...schema.tables,
  tournaments: widen(schema.tables.tournaments as unknown as ObjectTable, {
    bracketType: v.union(v.literal('single'), v.literal('double')) as never,
    grandFinal: v.optional(v.union(v.literal('ifNecessary'), v.literal('single'))) as never,
  }) as unknown as typeof schema.tables.tournaments,
  tournamentGames: widen(schema.tables.tournamentGames as unknown as ObjectTable, {
    stage: v.union(
      v.literal('bracket'),
      v.literal('losers'),
      v.literal('grandFinal'),
      v.literal('pool'),
    ) as never,
    loserNextGameId: v.optional(v.id('tournamentGames')) as never,
    loserNextSide: v.optional(v.union(v.literal(0), v.literal(1))) as never,
  }) as unknown as typeof schema.tables.tournamentGames,
});
