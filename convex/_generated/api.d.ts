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
import type * as customLevels from "../customLevels.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as leagues from "../leagues.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_authOrigins from "../lib/authOrigins.js";
import type * as lib_authUsers from "../lib/authUsers.js";
import type * as lib_customLevelInput from "../lib/customLevelInput.js";
import type * as lib_divisions from "../lib/divisions.js";
import type * as lib_forbidden from "../lib/forbidden.js";
import type * as lib_inviteInput from "../lib/inviteInput.js";
import type * as lib_inviteLookup from "../lib/inviteLookup.js";
import type * as lib_inviteStatus from "../lib/inviteStatus.js";
import type * as lib_inviteToken from "../lib/inviteToken.js";
import type * as lib_leagueDivision from "../lib/leagueDivision.js";
import type * as lib_leagueFilters from "../lib/leagueFilters.js";
import type * as lib_leagueInput from "../lib/leagueInput.js";
import type * as lib_leagueStatus from "../lib/leagueStatus.js";
import type * as lib_locationInput from "../lib/locationInput.js";
import type * as lib_logoFile from "../lib/logoFile.js";
import type * as lib_memberships from "../lib/memberships.js";
import type * as lib_organizationInput from "../lib/organizationInput.js";
import type * as lib_organizationLogo from "../lib/organizationLogo.js";
import type * as lib_password from "../lib/password.js";
import type * as lib_previewOrigin from "../lib/previewOrigin.js";
import type * as lib_publicLeague from "../lib/publicLeague.js";
import type * as lib_publicList from "../lib/publicList.js";
import type * as lib_publicPage from "../lib/publicPage.js";
import type * as lib_publicSeason from "../lib/publicSeason.js";
import type * as lib_registration from "../lib/registration.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_rosterEntry from "../lib/rosterEntry.js";
import type * as lib_rosterWrites from "../lib/rosterWrites.js";
import type * as lib_searchQuery from "../lib/searchQuery.js";
import type * as lib_seasonInput from "../lib/seasonInput.js";
import type * as lib_seasonLookup from "../lib/seasonLookup.js";
import type * as lib_seasonStatus from "../lib/seasonStatus.js";
import type * as lib_signInThrottle from "../lib/signInThrottle.js";
import type * as lib_slugs from "../lib/slugs.js";
import type * as lib_sports from "../lib/sports.js";
import type * as lib_teamInput from "../lib/teamInput.js";
import type * as lib_tenantWrites from "../lib/tenantWrites.js";
import type * as lib_testOnly from "../lib/testOnly.js";
import type * as lib_userName from "../lib/userName.js";
import type * as lib_users from "../lib/users.js";
import type * as locations from "../locations.js";
import type * as memberships from "../memberships.js";
import type * as organizations from "../organizations.js";
import type * as search from "../search.js";
import type * as seasons from "../seasons.js";
import type * as seed from "../seed.js";
import type * as seedAssets from "../seedAssets.js";
import type * as signInThrottle from "../signInThrottle.js";
import type * as teams from "../teams.js";
import type * as testing from "../testing.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  customLevels: typeof customLevels;
  health: typeof health;
  http: typeof http;
  invites: typeof invites;
  leagues: typeof leagues;
  "lib/access": typeof lib_access;
  "lib/authOrigins": typeof lib_authOrigins;
  "lib/authUsers": typeof lib_authUsers;
  "lib/customLevelInput": typeof lib_customLevelInput;
  "lib/divisions": typeof lib_divisions;
  "lib/forbidden": typeof lib_forbidden;
  "lib/inviteInput": typeof lib_inviteInput;
  "lib/inviteLookup": typeof lib_inviteLookup;
  "lib/inviteStatus": typeof lib_inviteStatus;
  "lib/inviteToken": typeof lib_inviteToken;
  "lib/leagueDivision": typeof lib_leagueDivision;
  "lib/leagueFilters": typeof lib_leagueFilters;
  "lib/leagueInput": typeof lib_leagueInput;
  "lib/leagueStatus": typeof lib_leagueStatus;
  "lib/locationInput": typeof lib_locationInput;
  "lib/logoFile": typeof lib_logoFile;
  "lib/memberships": typeof lib_memberships;
  "lib/organizationInput": typeof lib_organizationInput;
  "lib/organizationLogo": typeof lib_organizationLogo;
  "lib/password": typeof lib_password;
  "lib/previewOrigin": typeof lib_previewOrigin;
  "lib/publicLeague": typeof lib_publicLeague;
  "lib/publicList": typeof lib_publicList;
  "lib/publicPage": typeof lib_publicPage;
  "lib/publicSeason": typeof lib_publicSeason;
  "lib/registration": typeof lib_registration;
  "lib/roles": typeof lib_roles;
  "lib/rosterEntry": typeof lib_rosterEntry;
  "lib/rosterWrites": typeof lib_rosterWrites;
  "lib/searchQuery": typeof lib_searchQuery;
  "lib/seasonInput": typeof lib_seasonInput;
  "lib/seasonLookup": typeof lib_seasonLookup;
  "lib/seasonStatus": typeof lib_seasonStatus;
  "lib/signInThrottle": typeof lib_signInThrottle;
  "lib/slugs": typeof lib_slugs;
  "lib/sports": typeof lib_sports;
  "lib/teamInput": typeof lib_teamInput;
  "lib/tenantWrites": typeof lib_tenantWrites;
  "lib/testOnly": typeof lib_testOnly;
  "lib/userName": typeof lib_userName;
  "lib/users": typeof lib_users;
  locations: typeof locations;
  memberships: typeof memberships;
  organizations: typeof organizations;
  search: typeof search;
  seasons: typeof seasons;
  seed: typeof seed;
  seedAssets: typeof seedAssets;
  signInThrottle: typeof signInThrottle;
  teams: typeof teams;
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
