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
import type * as invites from "../invites.js";
import type * as leagues from "../leagues.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_authOrigins from "../lib/authOrigins.js";
import type * as lib_authUsers from "../lib/authUsers.js";
import type * as lib_forbidden from "../lib/forbidden.js";
import type * as lib_inviteInput from "../lib/inviteInput.js";
import type * as lib_inviteLookup from "../lib/inviteLookup.js";
import type * as lib_inviteStatus from "../lib/inviteStatus.js";
import type * as lib_inviteToken from "../lib/inviteToken.js";
import type * as lib_leagueInput from "../lib/leagueInput.js";
import type * as lib_leagueStatus from "../lib/leagueStatus.js";
import type * as lib_locationInput from "../lib/locationInput.js";
import type * as lib_memberships from "../lib/memberships.js";
import type * as lib_organizationInput from "../lib/organizationInput.js";
import type * as lib_password from "../lib/password.js";
import type * as lib_previewOrigin from "../lib/previewOrigin.js";
import type * as lib_publicPage from "../lib/publicPage.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_seasonInput from "../lib/seasonInput.js";
import type * as lib_seasonLookup from "../lib/seasonLookup.js";
import type * as lib_seasonStatus from "../lib/seasonStatus.js";
import type * as lib_signInThrottle from "../lib/signInThrottle.js";
import type * as lib_slugs from "../lib/slugs.js";
import type * as lib_sports from "../lib/sports.js";
import type * as lib_tenantWrites from "../lib/tenantWrites.js";
import type * as lib_testOnly from "../lib/testOnly.js";
import type * as lib_users from "../lib/users.js";
import type * as locations from "../locations.js";
import type * as memberships from "../memberships.js";
import type * as organizations from "../organizations.js";
import type * as seasons from "../seasons.js";
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
  invites: typeof invites;
  leagues: typeof leagues;
  "lib/access": typeof lib_access;
  "lib/authOrigins": typeof lib_authOrigins;
  "lib/authUsers": typeof lib_authUsers;
  "lib/forbidden": typeof lib_forbidden;
  "lib/inviteInput": typeof lib_inviteInput;
  "lib/inviteLookup": typeof lib_inviteLookup;
  "lib/inviteStatus": typeof lib_inviteStatus;
  "lib/inviteToken": typeof lib_inviteToken;
  "lib/leagueInput": typeof lib_leagueInput;
  "lib/leagueStatus": typeof lib_leagueStatus;
  "lib/locationInput": typeof lib_locationInput;
  "lib/memberships": typeof lib_memberships;
  "lib/organizationInput": typeof lib_organizationInput;
  "lib/password": typeof lib_password;
  "lib/previewOrigin": typeof lib_previewOrigin;
  "lib/publicPage": typeof lib_publicPage;
  "lib/roles": typeof lib_roles;
  "lib/seasonInput": typeof lib_seasonInput;
  "lib/seasonLookup": typeof lib_seasonLookup;
  "lib/seasonStatus": typeof lib_seasonStatus;
  "lib/signInThrottle": typeof lib_signInThrottle;
  "lib/slugs": typeof lib_slugs;
  "lib/sports": typeof lib_sports;
  "lib/tenantWrites": typeof lib_tenantWrites;
  "lib/testOnly": typeof lib_testOnly;
  "lib/users": typeof lib_users;
  locations: typeof locations;
  memberships: typeof memberships;
  organizations: typeof organizations;
  seasons: typeof seasons;
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
