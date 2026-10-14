import { ConvexError } from 'convex/values';

export function refuse(error: object): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}
