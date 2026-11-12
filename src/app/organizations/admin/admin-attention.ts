import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendar, lucidePencil, lucideUsers } from '@ng-icons/lucide';
import { api, injectQuery, skipToken } from '../../core/data/convex';
import { injectNowAtDeadlines } from '../../core/now-at-deadlines';
import { leaguePath } from '../league/league-path';
import { AdminAlert } from './admin-alert';
import { AdminContext } from './admin-context';
import { adminPath } from './admin-path';
import {
  attentionCount,
  CHECKED_LEAGUES_TEXT,
  inviteExpiryText,
  invitesPendingText,
  moreItemsText,
} from './attention-text';
import { OUTLINE_BUTTON } from './button-classes';
import { HlmCard } from '../../ui/card';

const PULSE = 'bg-muted motion-safe:animate-pulse';
const ROW = 'flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 md:px-5';
const ICON =
  'flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground';
const ACTION = `${OUTLINE_BUTTON} w-full sm:w-auto`;

@Component({
  selector: 'app-admin-attention',
  imports: [AdminAlert, HlmCard, NgIcon, RouterLink],
  providers: [provideIcons({ lucideCalendar, lucidePencil, lucideUsers })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block self-start xl:col-span-3' },
  template: `
    <section aria-labelledby="attention-heading" hlmCard size="bare" class="overflow-hidden">
      <div
        class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
      >
        <h2 id="attention-heading" class="font-semibold">Needs your attention</h2>
        @if (count(); as count) {
          <span data-slot="attention-count" class="text-sm text-muted-foreground"
            ><span aria-hidden="true">{{ count.shown }}</span
            ><span class="sr-only">{{ count.spoken }}</span></span
          >
        }
      </div>
      @if (failed()) {
        <div class="px-4 py-4 md:px-5">
          <app-admin-alert
            kind="error"
            title="Needs your attention could not be loaded."
            description="Check your connection."
            ><a [href]="overviewPath()">Try again</a></app-admin-alert
          >
        </div>
      } @else if (attention(); as attention) {
        @if (count()) {
          <ul role="list" class="divide-y divide-border">
            @for (item of attention.draftSeasons.items; track item.seasonId) {
              <li class="${ROW}">
                <span class="${ICON}"
                  ><ng-icon name="lucidePencil" class="text-lg" aria-hidden="true"
                /></span>
                <div class="min-w-0 flex-1">
                  <p class="font-medium">{{ item.name }} is a draft</p>
                  <p class="mt-0.5 text-sm text-muted-foreground">
                    {{ item.leagueName }} · players can't see it until you publish it
                  </p>
                </div>
                <a [routerLink]="leagueLink(item.leagueSlug)" data-slot="button" class="${ACTION}"
                  >Review<span class="sr-only"> {{ item.name }}, {{ item.leagueName }}</span></a
                >
              </li>
            }
            @if (moreDrafts(); as more) {
              <li class="px-4 py-3 text-sm text-muted-foreground md:px-5">{{ more }}</li>
            }
            @for (item of attention.leaguesWithoutSeason.items; track item.leagueId) {
              <li class="${ROW}">
                <span class="${ICON}"
                  ><ng-icon name="lucideCalendar" class="text-lg" aria-hidden="true"
                /></span>
                <div class="min-w-0 flex-1">
                  <p class="font-medium">{{ item.name }} has no season</p>
                  <p class="mt-0.5 text-sm text-muted-foreground">
                    Create one so players can register
                  </p>
                </div>
                <a
                  [routerLink]="leagueLink(item.slug)"
                  fragment="create-season"
                  data-slot="button"
                  class="${ACTION}"
                  >Create a season<span class="sr-only"> for {{ item.name }}</span></a
                >
              </li>
            }
            @if (moreLeagues(); as more) {
              <li class="px-4 py-3 text-sm text-muted-foreground md:px-5">{{ more }}</li>
            }
            @if (invitesText(); as invites) {
              <li class="${ROW}">
                <span class="${ICON}"
                  ><ng-icon name="lucideUsers" class="text-lg" aria-hidden="true"
                /></span>
                <div class="min-w-0 flex-1">
                  <p class="font-medium">{{ invites }}</p>
                  @for (line of inviteLines(); track line.email) {
                    <p class="mt-0.5 text-sm text-muted-foreground">
                      {{ line.email }} · {{ line.expiry }}
                    </p>
                  }
                </div>
                <a [routerLink]="staffPath()" data-slot="button" class="${ACTION}">Open Staff</a>
              </li>
            }
          </ul>
        } @else {
          <p class="px-4 py-4 text-muted-foreground md:px-5">Nothing needs your attention.</p>
        }
      } @else {
        <p role="status" class="sr-only">Loading what needs your attention.</p>
        <div aria-hidden="true" class="divide-y divide-border">
          @for (row of skeletonRows; track row) {
            <div class="${ROW}">
              <div class="${PULSE} size-9 shrink-0 rounded-lg"></div>
              <div class="min-w-0 flex-1">
                <div class="${PULSE} h-5 w-48 max-w-full rounded-md"></div>
                <div class="${PULSE} mt-1 h-4 w-64 max-w-full rounded-md"></div>
              </div>
              <div class="${PULSE} h-9 w-full rounded-lg pointer-coarse:h-11 sm:w-24"></div>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class AdminAttention {
  private readonly context = inject(AdminContext);

  protected readonly skeletonRows = [1, 2];

  private readonly query = injectQuery(api.organizations.getAttention, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  protected readonly attention = this.query.value;
  protected readonly failed = computed(() => this.query.error() !== undefined);

  protected readonly count = computed(() => {
    const attention = this.attention();
    return attention ? attentionCount(attention) : null;
  });

  protected readonly moreDrafts = computed(() => {
    const drafts = this.attention()?.draftSeasons;
    return drafts ? moreItemsText(drafts, drafts.items.length) : null;
  });

  protected readonly moreLeagues = computed(() => {
    const leagues = this.attention()?.leaguesWithoutSeason;
    if (!leagues) return null;
    return (
      moreItemsText(leagues, leagues.items.length) ?? (leagues.capped ? CHECKED_LEAGUES_TEXT : null)
    );
  });

  protected readonly invitesText = computed(() => {
    const invites = this.attention()?.pendingInvites;
    return invites && invites.total > 0 ? invitesPendingText(invites) : null;
  });

  private readonly now = injectNowAtDeadlines(
    () => this.attention()?.pendingInvites.soonest.map((invite) => invite.expiresAt) ?? [],
  );

  protected readonly inviteLines = computed(() => {
    const now = this.now();
    return (this.attention()?.pendingInvites.soonest ?? []).map((invite) => ({
      email: invite.email,
      expiry: inviteExpiryText(invite.expiresAt, now),
    }));
  });

  protected readonly overviewPath = computed(() => adminPath(this.context.slug()));
  protected readonly staffPath = computed(() => adminPath(this.context.slug(), 'staff'));

  protected leagueLink(leagueSlug: string): string {
    return leaguePath(this.context.slug(), leagueSlug);
  }
}
