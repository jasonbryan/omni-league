import {
  anyApi,
  getFunctionName as convexGetFunctionName,
  makeFunctionReference,
  type FunctionReference,
} from 'convex/server';
import { api, getFunctionName } from './api';
import { OFFLINE_SAVED_QUERIES } from './offline-saved-queries';
import { SAVED_COPY_PREFIX, savedCopyKey } from './saved-copies';

/** Walks a `module/path:export` name through an api object, as `api.module.path.export`. */
function referenceAt(root: unknown, name: string): FunctionReference<'query' | 'mutation'> {
  const [modulePath, exportName = 'default'] = name.split(':');
  const parts = [...modulePath.split('/'), exportName];
  return parts.reduce<unknown>(
    (node, part) => (node as Record<string, unknown>)[part],
    root,
  ) as FunctionReference<'query' | 'mutation'>;
}

const SAVED_QUERY_NAMES = [
  'organizations:getPublicPage',
  'organizations:listPublicLeagues',
  'organizations:listPublicLocations',
  'seasons:listOpenForOrganization',
  'organizations:listPublicLeagueFacets',
  'leagues:getPublicPage',
  'seasons:listPublic',
  'seasons:getPublicPage',
  'search:leagues',
  'search:organizations',
];

describe('the local Convex api and getFunctionName', () => {
  it('name every saved query as convex/server does', () => {
    const names = OFFLINE_SAVED_QUERIES.map(({ query }) => getFunctionName(query));
    expect(names).toEqual(SAVED_QUERY_NAMES);
    for (const [index, { query }] of OFFLINE_SAVED_QUERIES.entries()) {
      expect(convexGetFunctionName(query)).toBe(names[index]);
      expect(getFunctionName(query)).toBe(convexGetFunctionName(referenceAt(anyApi, names[index])));
    }
  });

  it('name a mutation as convex/server does', () => {
    const local = getFunctionName(api.organizations.create);
    expect(local).toBe('organizations:create');
    expect(convexGetFunctionName(api.organizations.create)).toBe(local);
    expect(convexGetFunctionName(anyApi['organizations']['create'])).toBe(local);
  });

  it('name nested modules and default exports as convex/server does', () => {
    for (const name of ['lib/nested:fn', 'module']) {
      expect(getFunctionName(referenceAt(api, name))).toBe(
        convexGetFunctionName(referenceAt(anyApi, name)),
      );
    }
  });

  it('read references made by convex/server', () => {
    expect(getFunctionName(makeFunctionReference<'query'>('teams:roster'))).toBe('teams:roster');
    expect(getFunctionName(anyApi['teams']['roster'])).toBe('teams:roster');
  });

  it('tag references as convex/server does', () => {
    expect(Object.prototype.toString.call(api.organizations.create)).toBe(
      Object.prototype.toString.call(anyApi['organizations']['create']),
    );
  });

  it('refuse a module without a function, and a value that is not a reference', () => {
    expect(() =>
      getFunctionName(api.organizations as unknown as FunctionReference<'query'>),
    ).toThrow();
    expect(() => getFunctionName({} as FunctionReference<'query'>)).toThrow();
  });

  it('keep the saved-copy key of every saved query, so copies saved by the previous build are found', () => {
    const args = { slug: 'org', page: 2, filters: { sport: 'soccer', gender: 'mixed' } };
    for (const { query } of OFFLINE_SAVED_QUERIES) {
      const name = convexGetFunctionName(referenceAt(anyApi, getFunctionName(query)));
      expect(savedCopyKey(query, args)).toBe(
        `${SAVED_COPY_PREFIX}${name}:{"filters":{"gender":"mixed","sport":"soccer"},"page":2,"slug":"org"}`,
      );
    }
  });
});
