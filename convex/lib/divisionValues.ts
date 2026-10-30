import { v, type Infer } from 'convex/values';

// Imports only `convex/values`, so `publicPage.ts` and the app's first bundle take these validators without the rest of `divisions.ts`.

export const genderValidator = v.union(v.literal('coed'), v.literal('mens'), v.literal('womens'));

export type Gender = Infer<typeof genderValidator>;

export const standardLevelValidator = v.union(
  v.literal('rec'),
  v.literal('b'),
  v.literal('bb'),
  v.literal('a'),
  v.literal('aa'),
  v.literal('open'),
  v.literal('intermediate'),
  v.literal('competitive'),
);

export type StandardLevel = Infer<typeof standardLevelValidator>;

export const ageGroupValidator = v.union(
  v.literal('adult'),
  v.literal('over30'),
  v.literal('over35'),
  v.literal('over40'),
  v.literal('over50'),
  v.literal('over55'),
  v.literal('over60'),
  v.literal('u6'),
  v.literal('u7'),
  v.literal('u8'),
  v.literal('u9'),
  v.literal('u10'),
  v.literal('u11'),
  v.literal('u12'),
  v.literal('u13'),
  v.literal('u14'),
  v.literal('u15'),
  v.literal('u16'),
  v.literal('u17'),
  v.literal('u18'),
  v.literal('u19'),
);

export type AgeGroup = Infer<typeof ageGroupValidator>;
