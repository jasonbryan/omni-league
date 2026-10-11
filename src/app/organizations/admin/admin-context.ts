import { Injectable, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { api } from '../../../../convex/_generated/api';
import { isForbidden } from '../../../../convex/lib/forbidden';
import { AuthService } from '../../core/auth/auth.service';
import { injectQuery, skipToken } from '../../core/data/convex';

/** The organization an admin may manage, as `organizations.getAdminContext` returns it. */
export type AdminOrganization = NonNullable<
  FunctionReturnType<typeof api.organizations.getAdminContext>
>;

/**
 * What the admin area shows: `loading` until `getAdminContext` answers, `ready` for an org admin,
 * `not-found` for an unknown slug (`null`), `forbidden` for the `FORBIDDEN` error, and `error`
 * for any other failure.
 */
export type AdminState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/**
 * The admin area's first question (#65): may the caller manage the organization in the route?
 * Provided by `AdminArea`, so its child pages inject the same answer. The query waits until Convex
 * has accepted the token, so its first answer is the caller's own, and nothing else in the area is
 * requested before it says `ready`: the children exist only then.
 */
@Injectable()
export class AdminContext {
  private readonly auth = inject(AuthService);

  /** The route's slug, from the `organizations/:slug` segment. */
  readonly slug = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('slug') ?? '')),
    { requireSync: true },
  );

  private readonly context = injectQuery(api.organizations.getAdminContext, () =>
    this.auth.convexAuthenticated() ? { slug: this.slug() } : skipToken,
  );

  readonly state = computed<AdminState>(() => {
    const error = this.context.error();
    if (error) return isForbidden(error) ? 'forbidden' : 'error';
    const value = this.context.value();
    if (value === undefined) return 'loading';
    return value === null ? 'not-found' : 'ready';
  });

  /** The organization, while `state()` is `ready`. */
  readonly organization = computed<AdminOrganization | null>(() =>
    this.state() === 'ready' ? (this.context.value() ?? null) : null,
  );
}

/**
 * Sets the page title to `<section> | <organization> | Omni League` while the area is ready
 * (design/mockups/65-organization-admin-locations.html, "Page title"). Call it in a child page's
 * injection context.
 */
export function bindAdminTitle(section: string): void {
  const context = inject(AdminContext);
  const title = inject(Title);
  effect(() => {
    const organization = context.organization();
    if (organization) title.setTitle(`${section} | ${organization.name} | Omni League`);
  });
}
