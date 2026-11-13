import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
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
  lucideEye,
  lucideInfo,
  lucideLock,
  lucidePencil,
  lucideShieldCheck,
  lucideUserMinus,
  lucideUserPlus,
  lucideUsers,
} from '@ng-icons/lucide';
import { map } from 'rxjs';
import { isForbidden, isForbiddenTournamentTeam } from '../../../convex/lib/forbidden';
import { AuthService } from '../core/auth/auth.service';
import type { Id } from '../../../convex/_generated/dataModel';
import { api, injectQuery, skipToken } from '../core/data/convex';
import { NotFoundView } from '../not-found/not-found-view';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { HlmBadge } from '../ui/badge';
import { organizationPath } from '../organizations/organization-path';
import {
  publicLeaguePath,
  publicSeasonPath,
} from '../organizations/public-league/public-league-path';
import { publicTournamentPath } from '../organizations/public-tournament/public-tournament-path';
import { ServerErrorView } from '../server-error/server-error-view';
import { Shell } from '../shell';
import { isPlainClick } from '../shell/follow-link';
import { initialsOf } from '../shell/initials';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from '../ui/button/button-classes';
import { AddMinorPanel } from './add-minor-panel';
import { RemovePlayerDialog, type RemovePlayerOutcome } from './remove-player-dialog';
import { removedText } from './remove-player-text';
import { rosterCount } from './roster-count';
import { SeasonTeamsPanel } from './season-teams-panel';
import { RenameMinorForm, type RenameMinorOutcome } from './rename-minor-form';
import { TeamInviteLanding } from './team-invite-landing';
import { TeamInvitePanel } from './team-invite-panel';
import { teamPath } from './team-paths';
import { TeamPendingInvites } from './team-pending-invites';
import { HlmCard } from '../ui/card';
import { HlmSkeleton } from '../ui/skeleton';

type TeamState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error';

interface RosterNotice {
  title: string;
  description?: string;
}

const PANEL = 'overflow-hidden';
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
    AddMinorPanel,
    AdminAlert,
    HlmBadge,
    HlmCard,
    HlmSkeleton,
    NgIcon,
    NotFoundView,
    RemovePlayerDialog,
    RenameMinorForm,
    RouterLink,
    SeasonTeamsPanel,
    ServerErrorView,
    Shell,
    TeamInvitePanel,
    TeamPendingInvites,
  ],
  providers: [
    TeamInviteLanding,
    provideIcons({
      lucideArrowLeft,
      lucideCircleCheck,
      lucideCrown,
      lucideEye,
      lucideInfo,
      lucideLock,
      lucidePencil,
      lucideShieldCheck,
      lucideUserMinus,
      lucideUserPlus,
      lucideUsers,
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
              hlmCard
              size="bare"
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
                @if (forbiddenTournamentTeam()) {
                  Only the players on teams in its tournament and the people who run it can see it.
                } @else {
                  Only the players on teams in its season and the league&rsquo;s organizers can see
                  it.
                }
                If you were removed from the team, ask the captain to invite you again.
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
              <div hlmSkeleton class="rounded-md h-4 w-28"></div>
            </div>
            <div aria-hidden="true" class="mt-3">
              <div hlmSkeleton class="rounded-md h-5 w-12"></div>
              <div hlmSkeleton class="rounded-md mt-2 h-8 w-56 max-w-full"></div>
              <div hlmSkeleton class="rounded-md mt-3 h-4 w-72 max-w-full"></div>
            </div>
            <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
              <div aria-hidden="true" hlmCard size="bare" class="${PANEL} lg:col-span-2">
                <div class="flex min-h-13 items-center border-b border-border px-4 py-3 md:px-5">
                  <div hlmSkeleton class="rounded-md h-5 w-24"></div>
                </div>
                <div class="divide-y divide-border">
                  @for (row of skeletonRows; track row) {
                    <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                      <div hlmSkeleton class="size-9 shrink-0 rounded-full"></div>
                      <div class="flex-1">
                        <div hlmSkeleton class="rounded-md h-5 w-40 max-w-full"></div>
                        <div hlmSkeleton class="rounded-md mt-2 h-5 w-20"></div>
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
                    @if (team.tournament; as tournament) {
                      <a [routerLink]="tournamentHref()" [class]="inlineLink">{{
                        tournament.name
                      }}</a>
                    } @else {
                      <a [routerLink]="seasonHref()" [class]="inlineLink">{{ seasonName() }}</a>
                      &middot;
                      <a [routerLink]="leagueHref()" [class]="inlineLink">{{ leagueName() }}</a>
                    }
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
                      /><span>{{ captainLine }}</span>
                    </p>
                  } @else if (team.viewerCanManage) {
                    <p class="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <ng-icon
                        name="lucideShieldCheck"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      /><span>{{ organizerLine() }}</span>
                    </p>
                  } @else if (viewerNote(); as note) {
                    <p
                      data-testid="viewer-note"
                      class="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground"
                    >
                      <ng-icon
                        [name]="note.icon"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      /><span>{{ note.text }}</span>
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
                  [description]="registeredDescription"
                  class="mt-4"
                />
              }
              <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
                <div class="flex flex-col gap-4 md:gap-6 lg:col-span-2">
                  <section aria-labelledby="roster-heading" hlmCard size="bare" class="${PANEL}">
                    <div
                      class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
                    >
                      <h2 id="roster-heading" tabindex="-1" class="font-semibold">Roster</h2>
                      <p class="text-sm text-muted-foreground tabular-nums">
                        <span data-testid="roster-count">{{ count().count }}</span>
                        @if (pendingCount(); as pending) {
                          &middot; <span data-testid="pending-count">{{ pending }}</span>
                        }
                      </p>
                    </div>
                    @if (rosterNotice(); as notice) {
                      <div class="border-b border-border px-4 py-3 md:px-5">
                        <app-admin-alert
                          #rosterStatus
                          kind="success"
                          [title]="notice.title"
                          [description]="notice.description"
                        />
                      </div>
                    }
                    <p
                      data-testid="roster-note"
                      class="flex items-start gap-1.5 border-b border-border px-4 py-3 text-sm text-muted-foreground md:px-5"
                    >
                      <ng-icon
                        [name]="count().met || count().full ? 'lucideCircleCheck' : 'lucideInfo'"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      /><span>{{ count().note }}</span>
                    </p>
                    <ul role="list" class="divide-y divide-border">
                      @for (player of team.roster; track player.rosterEntryId) {
                        @if (renaming() === player.rosterEntryId) {
                          <li class="px-4 py-4 md:px-5">
                            <app-rename-minor-form
                              [rosterEntryId]="player.rosterEntryId"
                              [currentName]="player.name"
                              (done)="renameDone($event)"
                            />
                          </li>
                        } @else {
                          <li
                            class="flex flex-wrap items-start gap-x-3 gap-y-3 px-4 py-3.5 md:px-5"
                          >
                            <span
                              aria-hidden="true"
                              class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                              >{{ initials(player.name) }}</span
                            >
                            <div class="min-w-0 flex-1">
                              <h3 class="font-medium break-words">
                                {{ player.name }}
                                @if (player.isViewer) {
                                  <span class="text-sm font-normal text-muted-foreground"
                                    >(you)</span
                                  >
                                }
                              </h3>
                              @if (player.isCaptain) {
                                <p
                                  class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                                >
                                  <span hlmBadge variant="secondary"
                                    ><ng-icon
                                      name="lucideCrown"
                                      data-icon="inline-start"
                                      aria-hidden="true"
                                    />Captain</span
                                  >
                                </p>
                              }
                              @if (player.minor; as minor) {
                                <p
                                  class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                                >
                                  <span hlmBadge variant="outline">Minor</span>
                                </p>
                                <p class="mt-1 text-sm text-muted-foreground">
                                  Guardian: {{ minor.guardianName }}
                                </p>
                              }
                            </div>
                            @if (player.viewerCanRename || player.viewerCanRemove) {
                              <div class="flex w-full flex-wrap gap-2 ps-12 sm:w-auto sm:ps-0">
                                @if (player.viewerCanRename) {
                                  <button
                                    type="button"
                                    data-slot="button"
                                    [attr.data-rename-entry-id]="player.rosterEntryId"
                                    [class]="outlineButton"
                                    (click)="openRename(player.rosterEntryId)"
                                  >
                                    <ng-icon
                                      name="lucidePencil"
                                      data-icon="inline-start"
                                      aria-hidden="true"
                                    />Rename<span class="sr-only"> {{ player.name }}</span>
                                  </button>
                                }
                                @if (player.viewerCanRemove) {
                                  <button
                                    type="button"
                                    aria-haspopup="dialog"
                                    data-slot="button"
                                    [attr.data-roster-entry-id]="player.rosterEntryId"
                                    [class]="destructiveButton"
                                    (click)="openRemove(player)"
                                  >
                                    <ng-icon
                                      name="lucideUserMinus"
                                      data-icon="inline-start"
                                      aria-hidden="true"
                                    />Remove<span class="sr-only">
                                      {{ player.name }} from {{ team.name }}</span
                                    >
                                  </button>
                                }
                              </div>
                            }
                          </li>
                        }
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
                <div class="flex flex-col gap-4 md:gap-6">
                  @if (fullPanel(); as full) {
                    <section
                      #fullSection
                      [id]="full.id"
                      aria-labelledby="team-full-heading"
                      hlmCard
                      size="bare"
                      class="${PANEL}"
                      data-testid="team-full"
                    >
                      <div
                        class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
                      >
                        <h2
                          #fullHeading
                          id="team-full-heading"
                          tabindex="-1"
                          class="rounded-sm font-semibold"
                        >
                          {{ full.heading }}
                        </h2>
                      </div>
                      <div class="flex flex-col items-center px-6 py-10 text-center">
                        <span
                          class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                          ><ng-icon name="lucideUsers" class="text-xl" aria-hidden="true"
                        /></span>
                        <p class="mt-4 font-medium">The team is full</p>
                        <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                          {{ full.text }}
                        </p>
                      </div>
                    </section>
                  } @else {
                    @if (team.viewerCanManage && teamIdOf(); as id) {
                      <app-team-invite-panel [teamId]="id" />
                    }
                    @if (team.viewerOnTeam && teamIdOf(); as id) {
                      <app-add-minor-panel [teamId]="id" [teamName]="team.name" />
                    }
                  }
                  <app-season-teams-panel
                    [rows]="seasonTeams.value()?.rows"
                    [total]="seasonTeams.value()?.total"
                    [failed]="seasonTeams.error() !== undefined"
                    [currentTeamId]="teamId()"
                    [scope]="team.tournament ? 'tournament' : 'season'"
                  />
                </div>
              </div>
            </div>
            @if (canRemoveAny()) {
              <app-remove-player-dialog
                [teamName]="team.name"
                (dismissed)="removeDismissed($event)"
              />
            }
          }
        }
      }
    </app-shell>
  `,
})
export class TeamPage {
  private readonly auth = inject(AuthService);
  private readonly title = inject(Title);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly skeletonRows = [0, 1, 2];
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly destructiveButton = DESTRUCTIVE_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly jumpClass = `${OUTLINE_BUTTON} lg:hidden`;
  protected readonly backLink = BACK_LINK;
  protected readonly inlineLink = INLINE_LINK;
  protected readonly initials = initialsOf;

  protected readonly teamId = toSignal(
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

  protected readonly forbiddenTournamentTeam = computed(() =>
    isForbiddenTournamentTeam(this.query.error()),
  );

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
    const team = this.team();
    return id && team?.viewerCanManage ? { teamId: id } : skipToken;
  });

  protected readonly seasonTeams = injectQuery(api.teams.listForSeasonMember, () => {
    const id = this.teamIdOf();
    return id ? { teamId: id } : skipToken;
  });

  protected readonly viewerNote = computed(() => {
    const team = this.team();
    if (!team) return null;
    if (team.roster.some((player) => player.isViewer)) {
      const captain = team.roster.find((player) => player.isCaptain);
      return {
        icon: 'lucideUsers',
        text: captain
          ? `You’re on this team. ${captain.name} is the captain.`
          : 'You’re on this team.',
      };
    }
    if (team.viewerOnTeam) {
      return { icon: 'lucideUsers', text: 'You’re the guardian of a minor on this team.' };
    }
    if (team.viewerTeamName === null) return null;
    return {
      icon: 'lucideEye',
      text: `You’re on ${team.viewerTeamName}. Teams in a ${team.tournament ? 'tournament' : 'season'} see each other’s rosters, so everyone who plays is listed.`,
    };
  });

  protected readonly pendingCount = computed(() => {
    const total = this.pending.value()?.total;
    if (total === undefined) return null;
    return `${total} pending ${total === 1 ? 'invite' : 'invites'}`;
  });

  private readonly arrivedRegistered =
    (inject(Router).currentNavigation()?.extras.state as TeamPageNavigationState | undefined)
      ?.registered === true;

  protected readonly registered = linkedSignal<string, boolean>({
    source: this.teamId,
    computation: (_teamId, previous) => (previous ? false : this.arrivedRegistered),
  });

  protected readonly registeredTitle = computed(() => {
    const team = this.team();
    return team
      ? `${team.name} is registered for ${team.tournament?.name ?? this.seasonName()}.`
      : '';
  });
  protected readonly registeredDescription =
    'Invite your players next. Each invite link is shown once.';
  protected readonly captainLine = 'You’re the captain. You invite players and manage the roster.';
  protected readonly organizerLine = computed(() => {
    const organized = this.team()?.tournament?.name ?? this.leagueName();
    return `You’re an organizer of ${organized}, so you can manage this team’s roster.`;
  });
  protected readonly seasonName = computed(() => this.team()?.season?.name ?? '');
  protected readonly leagueName = computed(() => this.team()?.league?.name ?? '');

  protected readonly count = computed(() => {
    const team = this.team();
    return rosterCount(team?.rosterCount ?? 0, team?.minimumRosterSize ?? 0, team?.maxRosterSize);
  });

  /** One note replaces the invite form and Add a minor, because minors take places too. */
  protected readonly fullPanel = computed(() => {
    const team = this.team();
    if (!team || !this.count().full || !(team.viewerCanManage || team.viewerOnTeam)) return null;
    const players = `${team.name} has ${team.rosterCount} players, this season’s maximum.`;
    return team.viewerCanManage
      ? {
          id: 'invite',
          heading: 'Invite players',
          text: `${players} Remove a player to invite someone else or add a minor.`,
        }
      : {
          id: 'add-minor',
          heading: 'Add a minor',
          text: `${players} Ask the captain to remove a player first.`,
        };
  });

  protected readonly seasonHref = computed(() => {
    const team = this.team();
    return team?.league && team.season
      ? publicSeasonPath(team.organization.slug, team.league.slug, team.season.slug)
      : '/';
  });
  protected readonly leagueHref = computed(() => {
    const team = this.team();
    return team?.league ? publicLeaguePath(team.organization.slug, team.league.slug) : '/';
  });
  protected readonly tournamentHref = computed(() => {
    const team = this.team();
    return team?.tournament
      ? publicTournamentPath(team.organization.slug, team.tournament.slug)
      : '/';
  });
  protected readonly organizationHref = computed(() => {
    const team = this.team();
    return team ? organizationPath(team.organization.slug) : '/';
  });

  private readonly registeredStatus = viewChild<AdminAlert>('registeredStatus');
  private readonly invitePanel = viewChild(TeamInvitePanel);
  private readonly fullSection = viewChild<ElementRef<HTMLElement>>('fullSection');
  private readonly fullHeading = viewChild<ElementRef<HTMLElement>>('fullHeading');
  private readonly landing = inject(TeamInviteLanding);
  /** The pending list sits above the invite panel, so landing before it answers would leave the panel moving. */
  private readonly landingStep = computed<'wait' | 'nothing' | 'land'>(() => {
    if (this.state() === 'loading') return 'wait';
    if (!this.team()?.viewerCanManage) return 'nothing';
    const answered = this.pending.value() !== undefined || this.pending.error() !== undefined;
    return answered ? 'land' : 'wait';
  });
  private readonly statusFocused = signal(false);
  private readonly removeDialog = viewChild(RemovePlayerDialog);
  private readonly rosterStatus = viewChild<AdminAlert>('rosterStatus');
  protected readonly rosterNotice = linkedSignal<string, RosterNotice | null>({
    source: this.teamId,
    computation: () => null,
  });
  protected readonly renaming = linkedSignal<string, Id<'rosterEntries'> | null>({
    source: this.teamId,
    computation: () => null,
  });
  protected readonly canRemoveAny = computed(
    () => this.team()?.roster.some((player) => player.viewerCanRemove) ?? false,
  );

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
    effect(() => {
      if (!this.landing.pending()) return;
      const step = this.landingStep();
      if (step === 'wait') return;
      if (step === 'nothing') {
        this.landing.settle();
        return;
      }
      afterNextRender(
        () => {
          if (!this.landing.pending()) return;
          this.showInvite();
          this.landing.settle();
        },
        { injector: this.injector },
      );
    });
  }

  protected openRename(rosterEntryId: Id<'rosterEntries'>): void {
    this.rosterNotice.set(null);
    this.renaming.set(rosterEntryId);
  }

  /** A rename focuses the status, because the form is gone; Cancel returns focus to the row's Rename. */
  protected renameDone({ rosterEntryId, renamed }: RenameMinorOutcome): void {
    this.renaming.set(null);
    if (renamed !== null) {
      this.rosterNotice.set({ title: `Renamed to ${renamed}.` });
      afterNextRender(() => this.rosterStatus()?.focus(), { injector: this.injector });
      return;
    }
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`button[data-rename-entry-id="${rosterEntryId}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  protected openRemove(player: { rosterEntryId: Id<'rosterEntries'>; name: string }): void {
    this.rosterNotice.set(null);
    this.removeDialog()?.open({ rosterEntryId: player.rosterEntryId, name: player.name });
  }

  /** A removal focuses the status, because the row and its Remove are gone. */
  protected removeDismissed({ rosterEntryId, name, removed }: RemovePlayerOutcome): void {
    if (removed) {
      this.rosterNotice.set(removedText(name, this.team()?.name ?? ''));
      afterNextRender(() => this.rosterStatus()?.focus(), { injector: this.injector });
      return;
    }
    afterNextRender(
      () => {
        const host: HTMLElement = this.host.nativeElement;
        const target =
          host.querySelector<HTMLElement>(`button[data-roster-entry-id="${rosterEntryId}"]`) ??
          host.querySelector<HTMLElement>('button[data-roster-entry-id]') ??
          host.querySelector<HTMLElement>('#roster-heading');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  protected jumpToPanel(event: MouseEvent): void {
    if (isPlainClick(event) && this.showInvite()) event.preventDefault();
  }

  private showInvite(): boolean {
    const panel = this.invitePanel();
    const form = panel?.scrollTarget();
    if (panel && form) {
      form.scrollIntoView();
      panel.focusFirst();
      return true;
    }
    const note = this.fullSection()?.nativeElement;
    if (!note || this.fullPanel()?.id !== 'invite') return false;
    note.scrollIntoView();
    this.fullHeading()?.nativeElement.focus({ preventScroll: true });
    return true;
  }
}
