import { expect } from 'vitest';
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

@Component({ template: 'elsewhere' })
export class Elsewhere {}

export const COASTAL = {
  organizationId: 'org_coastal',
  name: 'Coastal Bend Rec Club',
  slug: 'coastal-bend-rec-club',
};

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
export const ME = 'users:me';

export function forbiddenError(): ConvexError<{ code: string }> {
  return new ConvexError({ code: 'FORBIDDEN' });
}

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
  const subscription = (name: string): FakeSubscription | undefined =>
    convex.activeSubscriptions.find((s) => s.name === name);
  return { convex, auth, harness, page, flush, acceptToken, subscription };
}

export function adminRoutes(AdminArea: Type<unknown>, children: Routes): Routes {
  return [
    { path: 'app/organizations/:slug', component: AdminArea, children },
    { path: 'app', component: Elsewhere },
    { path: 'organizations/:orgSlug', component: Elsewhere },
  ];
}

export const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

type Asked = [name: string, args: unknown];

const askedKey = ([name, args]: Asked) => `${name} ${JSON.stringify(args)}`;

/** What the shell adds to every admin page: the account row and the slim bar's `users.me`, and the admin sidebar's four counts. */
export const SHELL_SUBSCRIPTIONS: Asked[] = [
  ['users:me', {}],
  ['users:me', {}],
  ...[
    'leagues:publishedCount',
    'leagues:listForAdmin',
    'locations:listForAdmin',
    'memberships:listForOrganization',
  ].map((name): Asked => [name, { organizationId: COASTAL.organizationId }]),
];

/** The page asks for these, besides the shell's. */
export function expectSubscriptions(convex: FakeConvexClient, page: Asked[]): void {
  const asked = convex.activeSubscriptions.map((s): Asked => [s.name, s.args]);
  expect(asked.map(askedKey).sort()).toEqual(
    [...page, ...SHELL_SUBSCRIPTIONS].map(askedKey).sort(),
  );
}
