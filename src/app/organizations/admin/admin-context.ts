import { Injectable, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import { map } from 'rxjs';
import { isForbidden } from '../../../../convex/lib/forbidden';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../../core/data/convex';
import { PageTitle } from '../../core/page-title';

export type AdminOrganization = NonNullable<
  FunctionReturnType<typeof api.organizations.getAdminContext>
>;

export type AdminState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

/** The query waits until Convex has accepted the token, so its first answer is the caller's own, and nothing else in the area is requested before it says `ready`: the children exist only then. */
@Injectable()
export class AdminContext {
  private readonly auth = inject(AuthService);

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

  readonly organization = computed<AdminOrganization | null>(() =>
    this.state() === 'ready' ? (this.context.value() ?? null) : null,
  );
}

export function bindAdminTitle(section: string, options: { bar?: 'organization' } = {}): void {
  const context = inject(AdminContext);
  const pageTitle = inject(PageTitle);
  effect(() => {
    const organization = context.organization();
    if (!organization) return;
    pageTitle.set([section, organization.name], {
      bar: options.bar === 'organization' ? organization.name : undefined,
    });
  });
}
