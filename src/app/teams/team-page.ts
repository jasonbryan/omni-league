import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideCircleCheck,
  lucideCrown,
  lucideInfo,
  lucideLock,
  lucideShieldCheck,
  lucideUserPlus,
} from '@ng-icons/lucide';
import { map } from 'rxjs';
import { isForbidden } from '../../../convex/lib/forbidden';
import { AuthService } from '../core/auth/auth.service';
import type { Id } from '../../../convex/_generated/dataModel';
import { api, injectQuery, skipToken } from '../core/data/convex';
import { NotFoundView } from '../not-found/not-found-view';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { BADGE_SECONDARY } from '../organizations/admin/field-classes';
import { organizationPath } from '../organizations/organization-path';
import {
  publicLeaguePath,
  publicSeasonPath,
} from '../organizations/public-league/public-league-path';
import { ServerErrorView } from '../server-error/server-error-view';
import { Shell } from '../shell';
import { isPlainClick } from '../shell/follow-link';
import { initialsOf } from '../shell/initials';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../ui/button/button-classes';
import { rosterCount } from './roster-count';
import { TeamInvitePanel } from './team-invite-panel';
import { teamPath } from './team-paths';
import { TeamPendingInvites } from './team-pending-invites';

type TeamState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

const SKELETON = 'rounded-md bg-muted motion-safe:animate-pulse';
const PANEL =
  'overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';
const BACK_LINK =
  'inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11';
const INLINE_LINK = 'underline underline-offset-4 hover:text-foreground';

/** Routed to from registration with `{ registered: true }` in the navigation state, which a reload or a shared link never carries. */
export interface TeamPageNavigationState {
  registered?: boolean;
}

@Component({
  selector: 'app-team-page',
  imports: [
    AdminAlert,
    NgIcon,
    NotFoundView,
    RouterLink,
    ServerErrorView,
    Shell,
    TeamInvitePanel,
    TeamPendingInvites,
  ],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideCircleCheck,
      lucideCrown,
      lucideInfo,
      lucideLock,
      lucideShieldCheck,
      lucideUserPlus,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @switch (state()) {
        @case ('not-found') {
          <app-not-found-view />
        }
        @case ('error') {
          <app-server-error-view [retryHref]="path()" />
        }
        @case ('forbidden') {
          <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
            <div
              class="mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center md:py-12 ${PANEL}"
            >
              <span
                class="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"
              >
                <ng-icon name="lucideLock" class="text-2xl" aria-hidden="true" />
              </span>
              <h1 class="mt-6 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
                You can&rsquo;t open this team page
              </h1>
              <p class="mt-3 text-balance text-muted-foreground">
                Only the team&rsquo;s players and the league&rsquo;s organizers can see it. If you
                should be on this team, ask its captain.
              </p>
              <a routerLink="/app" data-slot="button" [class]="primaryButton + ' mt-8'"
                ><ng-icon name="lucideArrowLeft" data-icon="inline-start" aria-hidden="true" />Go to
                your account</a
              >
            </div>
          </div>
        }
        @case ('loading') {
          <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
            <p role="status" class="sr-only">Loading the team.</p>
            <div aria-hidden="true" class="flex h-5 items-center pointer-coarse:h-11">
              <div class="${SKELETON} h-4 w-28"></div>
            </div>
            <div aria-hidden="true" class="mt-3">
              <div class="${SKELETON} h-5 w-12"></div>
              <div class="${SKELETON} mt-2 h-8 w-56 max-w-full"></div>
              <div class="${SKELETON} mt-3 h-4 w-72 max-w-full"></div>
            </div>
            <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
              <div aria-hidden="true" class="${PANEL} lg:col-span-2">
                <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
                  <div class="${SKELETON} h-5 w-24"></div>
                </div>
                <div class="divide-y divide-border">
                  @for (row of skeletonRows; track row) {
                    <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                      <div class="${SKELETON} size-9 shrink-0 rounded-full"></div>
                      <div class="flex-1">
                        <div class="${SKELETON} h-5 w-40 max-w-full"></div>
                        <div class="${SKELETON} mt-2 h-5 w-20"></div>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>
          </div>
        }
        @default {
          @if (team(); as team) {
            <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
              <a routerLink="/app" [class]="backLink"
                ><ng-icon name="lucideArrowLeft" class="text-base" aria-hidden="true" />Your
                account</a
              >
              <div class="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-muted-foreground">Team</p>
                  <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
                    {{ team.name }}
                  </h1>
                  <p class="mt-2 text-sm text-muted-foreground">
                    <a [routerLink]="seasonHref()" [class]="inlineLink">{{ team.season.name }}</a>
                    &middot;
                    <a [routerLink]="leagueHref()" [class]="inlineLink">{{ team.league.name }}</a>
                    &middot;
                    <a [routerLink]="organizationHref()" [class]="inlineLink">{{
                      team.organization.name
                    }}</a>
                  </p>
                  @if (team.viewerIsCaptain) {
                    <p class="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideCrown"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      /><span
                        >You&rsquo;re the captain. You invite players and manage the roster.</span
                      >
                    </p>
                  } @else if (team.viewerCanManage) {
                    <p class="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideShieldCheck"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      /><span
                        >You&rsquo;re an organizer of {{ team.league.name }}, so you can manage this
                        team&rsquo;s roster.</span
                      >
                    </p>
                  }
                </div>
                @if (team.viewerCanManage) {
                  <!-- The fragment link is explicit: a bare #invite would resolve against <base href="/"> to the home page. -->
                  <a
                    [href]="path() + '#invite'"
                    data-slot="button"
                    [class]="jumpClass"
                    (click)="jumpToPanel($event)"
                    ><ng-icon
                      name="lucideUserPlus"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Invite players</a
                  >
                }
              </div>
              @if (registered()) {
                <app-admin-alert
                  #registeredStatus
                  kind="success"
                  [title]="registeredTitle()"
                  description="Invite your players next. Each invite link is shown once."
                  class="mt-4"
                />
              }
              <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
                <div class="flex flex-col gap-4 md:gap-6 lg:col-span-2">
                  <section aria-labelledby="roster-heading" class="${PANEL}">
                    <div
                      class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
                    >
                      <h2 id="roster-heading" class="font-semibold">Roster</h2>
                      <p class="text-sm text-muted-foreground tabular-nums">
                        <span data-testid="roster-count">{{ count().count }}</span>
                        @if (pendingCount(); as pending) {
                          &middot; <span data-testid="pending-count">{{ pending }}</span>
                        }
                      </p>
                    </div>
                    <p
                      data-testid="roster-note"
                      class="flex items-start gap-1.5 border-b border-border px-4 py-3 text-sm text-muted-foreground md:px-5"
                    >
                      <ng-icon
                        [name]="count().met ? 'lucideCircleCheck' : 'lucideInfo'"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      /><span>{{ count().note }}</span>
                    </p>
                    <ul role="list" class="divide-y divide-border">
                      @for (player of team.roster; track player.rosterEntryId) {
                        <li class="flex flex-wrap items-start gap-x-3 gap-y-3 px-4 py-3.5 md:px-5">
                          <span
                            aria-hidden="true"
                            class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                            >{{ initials(player.name) }}</span
                          >
                          <div class="min-w-0 flex-1">
                            <h3 class="font-medium break-words">
                              {{ player.name }}
                              @if (player.isViewer) {
                                <span class="text-sm font-normal text-muted-foreground">(you)</span>
                              }
                            </h3>
                            @if (player.isCaptain) {
                              <p class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                <span data-slot="badge" [class]="captainBadge"
                                  ><ng-icon
                                    name="lucideCrown"
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />Captain</span
                                >
                              </p>
                            }
                          </div>
                        </li>
                      }
                    </ul>
                  </section>
                  @if (team.viewerCanManage) {
                    <app-team-pending-invites
                      [rows]="pending.value()?.rows"
                      [total]="pending.value()?.total"
                      [failed]="pending.error() !== undefined"
                    />
                  }
                </div>
                @if (team.viewerCanManage && teamIdOf(); as id) {
                  <app-team-invite-panel [teamId]="id" />
                }
              </div>
            </div>
          }
        }
      }
    </app-shell>
  `,
})
export class TeamPage {
  private readonly auth = inject(AuthService);
  private readonly title = inject(Title);

  protected readonly skeletonRows = [0, 1, 2];
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly jumpClass = `${OUTLINE_BUTTON} lg:hidden`;
  protected readonly backLink = BACK_LINK;
  protected readonly inlineLink = INLINE_LINK;
  protected readonly captainBadge = BADGE_SECONDARY;
  protected readonly initials = initialsOf;

  private readonly teamId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('teamId') ?? '')),
    { requireSync: true },
  );
  protected readonly path = computed(() => teamPath(this.teamId()));

  // Asked only once Convex has accepted the token, so the first answer is the caller's own.
  private readonly query = injectQuery(api.teams.getForMember, () =>
    this.auth.convexAuthenticated() ? { teamId: this.teamId() } : skipToken,
  );

  protected readonly state = computed<TeamState>(() => {
    const error = this.query.error();
    if (error) return isForbidden(error) ? 'forbidden' : 'error';
    const value = this.query.value();
    if (value === undefined) return 'loading';
    return value === null ? 'not-found' : 'ready';
  });

  protected readonly team = computed(() =>
    this.state() === 'ready' ? (this.query.value() ?? null) : null,
  );

  /** The id Convex accepted, so the invite calls never send one it would refuse. */
  protected readonly teamIdOf = computed(() =>
    this.team() ? (this.teamId() as Id<'teams'>) : null,
  );

  // Only for the captain and organizers: other members never see the addresses.
  protected readonly pending = injectQuery(api.teamInvites.listPending, () => {
    const id = this.teamIdOf();
    return id && this.team()?.viewerCanManage ? { teamId: id } : skipToken;
  });

  protected readonly pendingCount = computed(() => {
    const total = this.pending.value()?.total;
    if (total === undefined) return null;
    return `${total} pending ${total === 1 ? 'invite' : 'invites'}`;
  });

  protected readonly registered = signal(
    (inject(Router).currentNavigation()?.extras.state as TeamPageNavigationState | undefined)
      ?.registered === true,
  );

  protected readonly registeredTitle = computed(() => {
    const team = this.team();
    return team ? `${team.name} is registered for ${team.season.name}.` : '';
  });

  protected readonly count = computed(() => {
    const team = this.team();
    return rosterCount(team?.rosterCount ?? 0, team?.minimumRosterSize ?? 0);
  });

  protected readonly seasonHref = computed(() => {
    const team = this.team();
    return team
      ? publicSeasonPath(team.organization.slug, team.league.slug, team.season.slug)
      : '/';
  });
  protected readonly leagueHref = computed(() => {
    const team = this.team();
    return team ? publicLeaguePath(team.organization.slug, team.league.slug) : '/';
  });
  protected readonly organizationHref = computed(() => {
    const team = this.team();
    return team ? organizationPath(team.organization.slug) : '/';
  });

  private readonly registeredStatus = viewChild<AdminAlert>('registeredStatus');
  private readonly invitePanel = viewChild(TeamInvitePanel);
  private readonly statusFocused = signal(false);

  constructor() {
    // The not-found and server-error views set their own title.
    effect(() => {
      const team = this.team();
      if (team) this.title.setTitle(`${team.name} | Omni League`);
      else if (this.state() === 'forbidden') this.title.setTitle('No access | Omni League');
    });
    // The confirmation takes focus once, when it first shows with the team.
    effect(() => {
      const status = this.registeredStatus();
      if (!status || this.statusFocused()) return;
      this.statusFocused.set(true);
      status.focus();
    });
  }

  protected jumpToPanel(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const panel = this.invitePanel();
    const section = panel?.scrollTarget();
    if (!panel || !section) return;
    event.preventDefault();
    section.scrollIntoView();
    panel.focusFirst();
  }
}
