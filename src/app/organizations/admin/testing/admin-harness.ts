import { Component, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConvexError } from 'convex/values';
import { AuthService } from '../../../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../../../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../../../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../../../core/data/convex/testing/fake-convex-client';

/** Test-only: the pieces the admin-area specs share (#65). */

@Component({ template: 'elsewhere' })
export class Elsewhere {}

/** What `organizations.getAdminContext` returns for the mockup's organization. */
export const COASTAL = {
  organizationId: 'org_coastal',
  name: 'Coastal Bend Rec Club',
  slug: 'coastal-bend-rec-club',
};

/** What `locations.listForAdmin` returns for it (the mockup's populated state, sorted by name). */
export const COASTAL_LOCATIONS = [
  {
    locationId: 'loc_pelican',
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
  {
    locationId: 'loc_redfish',
    name: 'Redfish Flats Fields',
    address: '880 Redfish Flats Ln, Rockport, TX 78382',
  },
  {
    locationId: 'loc_tern',
    name: 'Tern Point Softball Complex',
    address: '4425 Tern Point Rd, Corpus Christi, TX 78414',
  },
];

export const GET_ADMIN_CONTEXT = 'organizations:getAdminContext';
export const LIST_FOR_ADMIN = 'locations:listForAdmin';
/** The top bar's account link (#63) asks this in every signed-in shell. */
export const ME = 'users:me';

/** The error `organizations.getAdminContext` throws for a caller who may not manage. */
export function forbiddenError(): ConvexError<{ code: string }> {
  return new ConvexError({ code: 'FORBIDDEN' });
}

/**
 * Opens `url` with `routes`, a signed-in browser (Convex has not accepted its token yet), and a
 * fake Convex client. `answer` makes Convex accept the token, as the page's queries wait for.
 */
export async function openAdmin(routes: Routes, url: string) {
  const convex = new FakeConvexClient();
  const auth = new FakeAuthClient();
  TestBed.configureTestingModule({
    providers: [
      provideFakeAuthClient(auth),
      { provide: CONVEX_CLIENT, useValue: convex },
      provideRouter(routes),
    ],
  });
  auth.emitSession({ id: 's1' });
  const harness = await RouterTestingHarness.create(url);
  const page = harness.routeNativeElement!;
  const flush = async () => {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
  };
  const acceptToken = () => {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
  };
  /** The active subscription to `name`, or `undefined`. */
  const subscription = (name: string): FakeSubscription | undefined =>
    convex.activeSubscriptions.find((s) => s.name === name);
  return { convex, auth, harness, page, flush, acceptToken, subscription };
}

/** Routes that serve `AdminArea` with the given children, and `/app` as a stub. */
export function adminRoutes(AdminArea: Type<unknown>, children: Routes): Routes {
  return [
    { path: 'app/organizations/:slug', component: AdminArea, children },
    { path: 'app', component: Elsewhere },
    { path: 'organizations/:orgSlug', component: Elsewhere },
  ];
}

export const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();
