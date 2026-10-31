import type { FunctionReference } from 'convex/server';
import type { api as generatedApi } from '../../../../../convex/_generated/api';

// The key convex/server's references keep their name under; the Convex clients read it.
const FUNCTION_NAME = Symbol.for('functionName');

function functionName(path: readonly string[]): string {
  if (path.length < 2) {
    throw new Error(`Expected a reference like api.module.function, got api.${path.join('.')}`);
  }
  const modulePath = path.slice(0, -1).join('/');
  const exportName = path[path.length - 1];
  return exportName === 'default' ? modulePath : `${modulePath}:${exportName}`;
}

function referenceAt(path: readonly string[]): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === 'string') return referenceAt([...path, property]);
        if (property === FUNCTION_NAME) return functionName(path);
        if (property === Symbol.toStringTag) return 'FunctionReference';
        return undefined;
      },
    },
  );
}

/**
 * The app's Convex function references, built here because importing `convex/_generated/api`
 * or `convex/server` at runtime puts Convex's server code (its schema builder) in the bundle.
 */
export const api = referenceAt([]) as typeof generatedApi;

export function getFunctionName(
  reference: FunctionReference<'query' | 'mutation' | 'action'>,
): string {
  const name: unknown = (reference as unknown as Record<symbol, unknown>)[FUNCTION_NAME];
  if (typeof name !== 'string' || name === '') {
    throw new Error('Expected a Convex function reference like api.module.function');
  }
  return name;
}
