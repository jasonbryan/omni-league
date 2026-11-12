import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBan,
  lucideClock,
  lucideClockAlert,
  lucideMail,
  lucideMailCheck,
} from '@ng-icons/lucide';
import type { Id } from '../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import { formatDay } from '../organizations/admin/format-day';
import { DESTRUCTIVE_BUTTON } from '../ui/button/button-classes';
import { HlmCard } from '../ui/card';
import { HlmSkeleton } from '../ui/skeleton';

export interface PendingInviteRow {
  inviteId: Id<'teamInvites'>;
  email: string;
  expiresAt: number;
}

type Notice = { kind: 'revoked'; email: string } | { kind: 'failed' } | { kind: 'offline' };

const PANEL = 'overflow-hidden';

/** Revoke acts at once, with no confirmation; the status above the list takes focus, because the button that had it is gone. */
@Component({
  selector: 'app-team-pending-invites',
  imports: [AdminAlert, AdminOfflineAlert, HlmCard, HlmSkeleton, NgIcon],
  providers: [
    provideIcons({ lucideBan, lucideClock, lucideClockAlert, lucideMail, lucideMailCheck }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section aria-labelledby="pending-heading" hlmCard size="bare" class="${PANEL}">
      <div
        class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
      >
        <h2 id="pending-heading" class="font-semibold">Pending invites</h2>
        @if (total() !== undefined) {
          <p class="text-sm text-muted-foreground tabular-nums">{{ total() }}</p>
        }
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
              />
            }
            @case ('offline') {
              <app-admin-offline-alert
                #noticeAlert
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
      @if (failed()) {
        <div class="px-4 py-4 md:px-5">
          <app-admin-alert
            kind="error"
            title="The pending invites could not be loaded."
            description="Check your connection and try again."
          />
        </div>
      } @else if (shownRows(); as rows) {
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
                  @if (row.expired) {
                    <p class="mt-1 flex items-center gap-1.5 text-sm font-medium text-destructive">
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
                      />Expires
                      {{ day(row.expiresAt) }}
                    </p>
                  }
                </div>
                <div class="w-full ps-12 sm:w-auto sm:ps-0">
                  <button
                    type="button"
                    data-slot="button"
                    [class]="destructiveButton"
                    [class.opacity-50]="!online()"
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
              ><ng-icon name="lucideMailCheck" class="text-xl" aria-hidden="true"
            /></span>
            <p class="mt-4 font-medium">No pending invites</p>
            <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
              Invites you create appear here until they’re accepted or revoked.
            </p>
          </div>
        }
      } @else {
        <p role="status" class="sr-only">Loading the pending invites.</p>
        <div aria-hidden="true" class="divide-y divide-border">
          @for (placeholder of placeholders; track placeholder) {
            <div class="flex gap-3 px-4 py-3.5 md:px-5">
              <div hlmSkeleton class="size-9 shrink-0 rounded-lg"></div>
              <div class="flex-1">
                <div hlmSkeleton class="rounded-md h-5 w-48 max-w-full"></div>
                <div hlmSkeleton class="rounded-md mt-2 h-5 w-36 max-w-full"></div>
              </div>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class TeamPendingInvites {
  private readonly injector = inject(Injector);
  private readonly revokeCall = injectMutation(api.teamInvites.revoke);

  readonly rows = input<readonly PendingInviteRow[] | undefined>();
  readonly total = input<number | undefined>();
  readonly failed = input(false);

  protected readonly online = injectOnline();
  protected readonly destructiveButton = DESTRUCTIVE_BUTTON;
  protected readonly placeholders = [1, 2];
  protected readonly day = formatDay;

  protected readonly shownRows = computed(() => {
    const rows = this.rows();
    if (rows === undefined) return undefined;
    const now = Date.now();
    return rows.map((row) => ({ ...row, expired: row.expiresAt <= now }));
  });

  protected readonly notice = signal<Notice | null>(null);
  private readonly noticeAlert = viewChild<AdminAlert | AdminOfflineAlert>('noticeAlert');

  protected async revoke(inviteId: Id<'teamInvites'>, email: string): Promise<void> {
    if (this.revokeCall.pending()) return;
    this.notice.set(null);
    if (!this.online()) {
      this.show({ kind: 'offline' });
      return;
    }
    try {
      await this.revokeCall.run({ inviteId });
      this.show({ kind: 'revoked', email });
    } catch (failure) {
      this.show(failure instanceof ConvexOfflineError ? { kind: 'offline' } : { kind: 'failed' });
    }
  }

  private show(notice: Notice): void {
    this.notice.set(notice);
    afterNextRender(() => this.noticeAlert()?.focus(), { injector: this.injector });
  }
}
