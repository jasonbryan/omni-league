import { v, type Infer } from 'convex/values';

export const seasonStatusValidator = v.union(v.literal('draft'), v.literal('published'));

export type SeasonStatus = Infer<typeof seasonStatusValidator>;
