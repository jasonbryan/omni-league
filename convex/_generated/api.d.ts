/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_authOrigins from "../lib/authOrigins.js";
import type * as lib_memberships from "../lib/memberships.js";
import type * as lib_organizationInput from "../lib/organizationInput.js";
import type * as lib_password from "../lib/password.js";
import type * as lib_previewOrigin from "../lib/previewOrigin.js";
import type * as lib_publicPage from "../lib/publicPage.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_signInThrottle from "../lib/signInThrottle.js";
import type * as lib_slugs from "../lib/slugs.js";
import type * as lib_sports from "../lib/sports.js";
import type * as lib_tenantWrites from "../lib/tenantWrites.js";
import type * as lib_testOnly from "../lib/testOnly.js";
import type * as lib_users from "../lib/users.js";
import type * as organizations from "../organizations.js";
import type * as seed from "../seed.js";
import type * as signInThrottle from "../signInThrottle.js";
import type * as testing from "../testing.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  health: typeof health;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/authOrigins": typeof lib_authOrigins;
  "lib/memberships": typeof lib_memberships;
  "lib/organizationInput": typeof lib_organizationInput;
  "lib/password": typeof lib_password;
  "lib/previewOrigin": typeof lib_previewOrigin;
  "lib/publicPage": typeof lib_publicPage;
  "lib/roles": typeof lib_roles;
  "lib/signInThrottle": typeof lib_signInThrottle;
  "lib/slugs": typeof lib_slugs;
  "lib/sports": typeof lib_sports;
  "lib/tenantWrites": typeof lib_tenantWrites;
  "lib/testOnly": typeof lib_testOnly;
  "lib/users": typeof lib_users;
  organizations: typeof organizations;
  seed: typeof seed;
  signInThrottle: typeof signInThrottle;
  testing: typeof testing;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
