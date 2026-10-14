import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { ConvexError } from 'convex/values';
import {
  lucideBan,
  lucideClock,
  lucideClockAlert,
  lucideLoaderCircle,
  lucideMail,
  lucideUndo2,
  lucideUserPlus,
  lucideUsers,
} from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { INVITE_MESSAGES } from '../../../../convex/lib/inviteInput';
import type { Role } from '../../../../convex/lib/roles';
import {
  ConvexOfflineError,
  injectMutation,
  injectOnline,
  injectQuery,
  skipToken,
} from '../../core/data/convex';
import { initials } from '../initials';
import { isPlainClick } from '../../shell/follow-link';
import { AdminAlert } from './admin-alert';
import { AdminContext, bindAdminTitle } from './admin-context';
import { adminPath } from './admin-path';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON } from './button-classes';
import { BADGE_SECONDARY } from './field-classes';
import { formatDay } from './format-day';
import { StaffInvitePanel } from './staff-invite-panel';

type RestoreRefusal =
  'windowPassed' | 'expired' | 'alreadyInvited' | 'alreadyMember' | 'leaguesGone';

const RESTORE_REFUSALS: readonly string[] = [
  'windowPassed',
  'expired',
  'alreadyInvited',
  'alreadyMember',
  'leaguesGone',
] satisfies RestoreRefusal[];

type Notice =
  | { kind: 'revoked'; inviteId: Id<'invites'>; email: string }
  | { kind: 'failed' }
  | { kind: 'offline' }
  | { kind: 'restored'; email: string }
  | { kind: 'refused'; email: string; reason: RestoreRefusal }
  | { kind: 'restoreFailed'; inviteId: Id<'invites'>; email: string }
  | { kind: 'restoreOffline'; inviteId: Id<'invites'>; email: string };

function refusalOf(failure: unknown): RestoreRefusal | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  const code = typeof data === 'object' && data !== null && 'code' in data ? data.code : null;
  return typeof code === 'string' && RESTORE_REFUSALS.includes(code)
    ? (code as RestoreRefusal)
    : null;
}

const ROLE_LABEL: Record<Role, string> = {
  orgAdmin: 'Org admin',
  leagueOrganizer: 'League organizer',
};

/**
 * Revoke acts at once, with no confirmation: a status above the list says so and takes focus, because the button that had it is gone. The status carries Undo, which `invites.restore` allows
 * for 10 minutes after the revoke (the server enforces it) and which makes the link already sent work again.
 * Every query here is org-admin only; the area's parent has already shown the no-access view to anyone else, so none is asked for them.
 */
@Component({
  selector: 'app-admin-staff',
  imports: [AdminAlert, NgIcon, NgTemplateOutlet, StaffInvitePanel],
  providers: [
    provideIcons({
      lucideBan,
      lucideClock,
      lucideClockAlert,
      lucideLoaderCircle,
      lucideMail,
      lucideUndo2,
      lucideUserPlus,
      lucideUsers,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    @if (organization(); as organization) {
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-muted-foreground">{{ organization.name }}</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">Staff</h1>
          <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
            Org admins manage everything here. League organizers run the leagues you assign them.
          </p>
        </div>
        <!-- The fragment link is explicit: a bare #invite would resolve against <base href="/"> to the home page. -->
        <a
          [href]="invitePath()"
          data-slot="button"
          [class]="jumpClass"
          (click)="jumpToPanel($event)"
          ><ng-icon name="lucideUserPlus" data-icon="inline-start" aria-hidden="true" />Invite
          staff</a
        >
      </div>
      <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
        <div class="flex flex-col gap-4 md:gap-6 lg:col-span-2">
          <section
            aria-labelledby="members-heading"
            class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
          >
            <div
              class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
            >
              <h2 id="members-heading" class="font-semibold">Members</h2>
            </div>
            @if (membersFailed()) {
              <div class="px-4 py-4 md:px-5">
                <app-admin-alert
                  kind="error"
                  title="The staff could not be loaded."
                  description="Check your connection and try again."
                />
              </div>
            } @else if (memberRows(); as rows) {
              <ul id="members-list" role="list" class="divide-y divide-border">
                @for (row of rows; track row.email) {
                  <li class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                    <span
                      aria-hidden="true"
                      class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                      >{{ initialsOf(row.name) }}</span
                    >
                    <div class="min-w-0 flex-1">
                      <h3 class="font-medium">
                        {{ row.name }}
                        @if (row.isYou) {
                          <span class="text-sm font-normal text-muted-foreground">(you)</span>
                        }
                      </h3>
                      <p class="mt-0.5 text-sm break-words text-muted-foreground">
                        {{ row.email }}
                      </p>
                      <p class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span data-slot="badge" data-variant="secondary" [class]="secondaryBadge">{{
                          roleLabel(row.role)
                        }}</span>
                        @if (row.leagueNames.length > 0) {
                          <span class="text-muted-foreground"
                            >&ngsp;for {{ row.leagueNames.join(', ') }}</span
                          >
                        }
                      </p>
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <p role="status" class="sr-only">Loading the staff.</p>
              <div aria-hidden="true" class="divide-y divide-border">
                @for (placeholder of placeholders; track placeholder) {
                  <div class="flex gap-3 px-4 py-3.5 md:px-5">
                    <div
                      class="size-9 shrink-0 rounded-full bg-muted motion-safe:animate-pulse"
                    ></div>
                    <div class="flex-1">
                      <div
                        class="h-4 w-40 max-w-full rounded-md bg-muted motion-safe:animate-pulse"
                      ></div>
                      <div
                        class="mt-2 h-3.5 w-56 max-w-full rounded-md bg-muted motion-safe:animate-pulse"
                      ></div>
                    </div>
                  </div>
                }
              </div>
            }
          </section>
          <section
            aria-labelledby="pending-heading"
            class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
          >
            <div
              class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
            >
              <h2 id="pending-heading" class="font-semibold">Pending invites</h2>
            </div>
            @if (notice(); as notice) {
              <div class="border-b border-border px-4 py-3 md:px-5">
                @switch (notice.kind) {
                  @case ('revoked') {
                    <app-admin-alert
                      #noticeAlert
                      kind="success"
                      [title]="'Invite to ' + notice.email + ' revoked.'"
                      description="Its link no longer works. You can invite this address again."
                    >
                      <ng-container [ngTemplateOutlet]="undoAction" />
                    </app-admin-alert>
                  }
                  @case ('restored') {
                    <app-admin-alert
                      #noticeAlert
                      kind="success"
                      [title]="'Invite to ' + notice.email + ' restored.'"
                      description="Its link works again."
                    />
                  }
                  @case ('refused') {
                    <app-admin-alert
                      #noticeAlert
                      kind="error"
                      [title]="'Invite to ' + notice.email + ' could not be restored.'"
                      [description]="refusalText(notice.reason, notice.email)"
                    />
                  }
                  @case ('restoreFailed') {
                    <app-admin-alert
                      #noticeAlert
                      kind="error"
                      title="The invite could not be restored."
                      description="Check your connection and try again."
                    >
                      <ng-container [ngTemplateOutlet]="undoAction" />
                    </app-admin-alert>
                  }
                  @case ('restoreOffline') {
                    <app-admin-alert
                      #noticeAlert
                      kind="offline"
                      title="You're offline. Nothing was sent."
                      description="The invite is still revoked. Try again when you're connected."
                    >
                      <ng-container [ngTemplateOutlet]="undoAction" />
                    </app-admin-alert>
                  }
                  @case ('offline') {
                    <app-admin-alert
                      #noticeAlert
                      kind="offline"
                      title="You're offline. Nothing was sent."
                      description="The invite is unchanged. Try again when you're connected."
                    />
                  }
                  @default {
                    <app-admin-alert
                      #noticeAlert
                      kind="error"
                      title="The invite could not be revoked."
                      description="Check your connection and try again."
                    />
                  }
                }
              </div>
            }
            @if (pendingFailed()) {
              <div class="px-4 py-4 md:px-5">
                <app-admin-alert
                  kind="error"
                  title="The pending invites could not be loaded."
                  description="Check your connection and try again."
                />
              </div>
            } @else if (pendingRows(); as rows) {
              @if (rows.length > 0) {
                <ul id="pending-list" role="list" class="divide-y divide-border">
                  @for (row of rows; track row.inviteId) {
                    <li class="flex flex-wrap items-start gap-x-3 gap-y-3 px-4 py-3.5 md:px-5">
                      <span
                        class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                        ><ng-icon name="lucideMail" class="text-lg" aria-hidden="true"
                      /></span>
                      <div class="min-w-0 flex-1">
                        <h3 class="font-medium break-words">{{ row.email }}</h3>
                        <p class="mt-0.5 text-sm text-muted-foreground">
                          {{ roleLabel(row.role) }}
                          @if (row.leagueNames.length > 0) {
                            for {{ row.leagueNames.join(', ') }}
                          }
                        </p>
                        @if (row.expired) {
                          <p
                            class="mt-1 flex items-center gap-1.5 text-sm font-medium text-destructive"
                          >
                            <ng-icon
                              name="lucideClockAlert"
                              class="shrink-0 text-base"
                              aria-hidden="true"
                            />Expired {{ day(row.expiresAt) }}
                          </p>
                          <p class="mt-0.5 text-sm text-muted-foreground">
                            Revoke it to invite this address again.
                          </p>
                        } @else {
                          <p class="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                            <ng-icon
                              name="lucideClock"
                              class="shrink-0 text-base"
                              aria-hidden="true"
                            />Expires {{ day(row.expiresAt) }}
                          </p>
                        }
                      </div>
                      <div class="w-full ps-12 sm:w-auto sm:ps-0">
                        <button
                          type="button"
                          data-slot="button"
                          [class]="online() ? destructiveButton : destructiveButton + ' opacity-50'"
                          [attr.aria-disabled]="online() ? null : 'true'"
                          (click)="revoke(row.inviteId, row.email)"
                        >
                          <ng-icon
                            name="lucideBan"
                            data-icon="inline-start"
                            aria-hidden="true"
                          />Revoke<span class="sr-only"> the invite to {{ row.email }}</span>
                        </button>
                      </div>
                    </li>
                  }
                </ul>
              } @else {
                <div class="flex flex-col items-center px-6 py-10 text-center">
                  <span
                    class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                    ><ng-icon name="lucideMail" class="text-xl" aria-hidden="true"
                  /></span>
                  <p class="mt-4 font-medium">No pending invites</p>
                  <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                    Invites you create wait here until they’re accepted or revoked.
                  </p>
                </div>
              }
            } @else {
              <p role="status" class="sr-only">Loading the pending invites.</p>
              <div aria-hidden="true" class="divide-y divide-border">
                @for (placeholder of placeholders; track placeholder) {
                  <div class="flex gap-3 px-4 py-3.5 md:px-5">
                    <div
                      class="size-9 shrink-0 rounded-lg bg-muted motion-safe:animate-pulse"
                    ></div>
                    <div class="flex-1">
                      <div
                        class="h-4 w-48 max-w-full rounded-md bg-muted motion-safe:animate-pulse"
                      ></div>
                      <div
                        class="mt-2 h-3.5 w-64 max-w-full rounded-md bg-muted motion-safe:animate-pulse"
                      ></div>
                    </div>
                  </div>
                }
              </div>
            }
          </section>
        </div>
        <app-staff-invite-panel
          [organizationId]="organization.organizationId"
          [organizationName]="organization.name"
          [leagues]="leagueChoices()"
          [leaguesFailed]="leaguesFailed()"
        />
      </div>
    }
    <!-- Undo, inside the status that offers it. aria-disabled, not disabled, so it keeps focus while it works or while offline. -->
    <ng-template #undoAction>
      @if (undoTarget(); as target) {
        <div class="mt-2">
          <button
            type="button"
            data-slot="button"
            [class]="undoClass"
            [class.opacity-50]="!online() && !restoring()"
            [attr.aria-disabled]="restoring() || !online() ? 'true' : null"
            (click)="restore(target.inviteId, target.email)"
          >
            @if (restoring()) {
              <ng-icon
                name="lucideLoaderCircle"
                class="motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />Undoing…
            } @else {
              <ng-icon name="lucideUndo2" data-icon="inline-start" aria-hidden="true" />Undo<span
                class="sr-only"
              >
                revoking the invite to {{ target.email }}</span
              >
            }
          </button>
        </div>
      }
    </ng-template>
  `,
})
export class AdminStaff {
  private readonly context = inject(AdminContext);
  private readonly injector = inject(Injector);
  private readonly revokeCall = injectMutation(api.invites.revoke);
  private readonly restoreCall = injectMutation(api.invites.restore);

  protected readonly organization = this.context.organization;
  protected readonly online = injectOnline();
  protected readonly jumpClass = `${OUTLINE_BUTTON} lg:hidden`;
  protected readonly destructiveButton = DESTRUCTIVE_BUTTON;
  protected readonly undoClass = `${OUTLINE_BUTTON} pointer-coarse:min-h-11 pointer-coarse:px-4`;
  protected readonly restoring = computed(() => this.restoreCall.pending());
  protected readonly secondaryBadge = BADGE_SECONDARY;
  protected readonly placeholders = [1, 2, 3];
  protected readonly day = formatDay;
  protected readonly initialsOf = initials;

  private readonly memberList = injectQuery(api.memberships.listForOrganization, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  private readonly pendingList = injectQuery(api.invites.listPending, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  private readonly leagueList = injectQuery(api.leagues.listForAdmin, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  protected readonly memberRows = computed(() => this.memberList.value());
  protected readonly membersFailed = computed(() => this.memberList.error() !== undefined);
  protected readonly pendingFailed = computed(() => this.pendingList.error() !== undefined);
  protected readonly leaguesFailed = computed(() => this.leagueList.error() !== undefined);

  protected readonly pendingRows = computed(() => {
    const rows = this.pendingList.value();
    if (rows === undefined) return undefined;
    const now = Date.now();
    return rows.map((row) => ({ ...row, expired: row.expiresAt <= now }));
  });

  protected readonly leagueChoices = computed(() =>
    this.leagueList.value()?.map(({ leagueId, name }) => ({ leagueId, name })),
  );

  protected readonly invitePath = computed(
    () => `${adminPath(this.context.slug(), 'staff')}#invite`,
  );

  protected readonly notice = signal<Notice | null>(null);

  protected readonly undoTarget = computed(() => {
    const notice = this.notice();
    return notice && 'inviteId' in notice ? notice : null;
  });

  private readonly panel = viewChild(StaffInvitePanel);
  private readonly noticeAlert = viewChild<AdminAlert>('noticeAlert');

  constructor() {
    bindAdminTitle('Staff');
  }

  protected roleLabel(role: Role): string {
    return ROLE_LABEL[role];
  }

  protected jumpToPanel(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const panel = this.panel();
    const section = panel?.scrollTarget();
    if (!panel || !section) return;
    event.preventDefault();
    section.scrollIntoView();
    panel.focusFirst();
  }

  protected async revoke(inviteId: Id<'invites'>, email: string): Promise<void> {
    if (this.revokeCall.pending() || this.restoreCall.pending()) return;
    this.notice.set(null);
    if (!this.online()) {
      this.show({ kind: 'offline' });
      return;
    }
    try {
      await this.revokeCall.run({ inviteId });
      this.show({ kind: 'revoked', inviteId, email });
    } catch (failure) {
      this.show(failure instanceof ConvexOfflineError ? { kind: 'offline' } : { kind: 'failed' });
    }
  }

  protected refusalText(reason: RestoreRefusal, email: string): string {
    switch (reason) {
      case 'windowPassed':
        return INVITE_MESSAGES.restoreWindowPassed;
      case 'expired':
        return INVITE_MESSAGES.restoreExpired;
      case 'alreadyInvited':
        return INVITE_MESSAGES.restoreAlreadyInvited(email);
      case 'alreadyMember':
        return INVITE_MESSAGES.alreadyMember(email);
      case 'leaguesGone':
        return INVITE_MESSAGES.restoreLeaguesGone;
    }
  }

  /** The status takes focus either way, because Undo has gone or the alert replaced it. */
  protected async restore(inviteId: Id<'invites'>, email: string): Promise<void> {
    if (this.restoreCall.pending()) return;
    if (!this.online()) {
      this.show({ kind: 'restoreOffline', inviteId, email });
      return;
    }
    try {
      await this.restoreCall.run({ inviteId });
      this.show({ kind: 'restored', email });
    } catch (failure) {
      const reason = refusalOf(failure);
      if (reason) this.show({ kind: 'refused', email, reason });
      else if (failure instanceof ConvexOfflineError) {
        this.show({ kind: 'restoreOffline', inviteId, email });
      } else this.show({ kind: 'restoreFailed', inviteId, email });
    }
  }

  private show(notice: Notice): void {
    this.notice.set(notice);
    afterNextRender(() => this.noticeAlert()?.focus(), { injector: this.injector });
  }
}
