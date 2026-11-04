import type { FunctionReference } from 'convex/server';

// The key convex/server's references keep their name under; the Convex clients read it.
export const FUNCTION_NAME = Symbol.for('functionName');

export function getFunctionName(
  reference: FunctionReference<'query' | 'mutation' | 'action'>,
): string {
  const name: unknown = (reference as unknown as Record<symbol, unknown>)[FUNCTION_NAME];
  if (typeof name !== 'string' || name === '') {
    throw new Error('Expected a Convex function reference like api.module.function');
  }
  return name;
}
