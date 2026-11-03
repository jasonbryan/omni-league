import { v, type Infer } from 'convex/values';

export const freeAgentStatusValidator = v.union(v.literal('waiting'), v.literal('placed'));

export type FreeAgentStatus = Infer<typeof freeAgentStatusValidator>;
