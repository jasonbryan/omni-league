import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarClock,
  lucideCalendarDays,
  lucideChevronRight,
  lucideCircleCheck,
  lucideCircleDashed,
  lucideListOrdered,
  lucideMail,
  lucideTriangleAlert,
  lucideUserPlus,
  lucideUserRound,
  lucideUsers,
  lucideUsersRound,
} from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { sportName } from '../../../../convex/lib/sports';
import { teamPath } from '../../teams/team-paths';
import { AdminAlert } from '../admin/admin-alert';
import type { AlertText } from '../admin/alert-text';
import { OUTLINE_BUTTON } from '../admin/button-classes';
import {
  BADGE_DEFAULT,
  BADGE_OUTLINE,
  BADGE_OUTLINE_DESTRUCTIVE,
  BADGE_SECONDARY,
} from '../admin/field-classes';
import { formatDay } from '../admin/format-day';
import { ROW_TITLE_LINK } from '../admin/link-classes';
import { CURRENT_CRUMB_LINK, LEAGUE_CRUMB_LINK, NAME_CRUMB } from '../league/league-breadcrumb';
import { leaguePath } from '../league/league-path';
import { seasonDates } from '../league/season-dates';
import { PlaceFreeAgentDialog, type PlaceFreeAgentOutcome } from './place-free-agent-dialog';
import { placedText } from './place-free-agent-text';
import { SeasonContext, type SeasonFreeAgents } from './season-context';
import { SeasonLimits } from './season-limits';
import { SeasonWaitlistPanel } from './season-waitlist-panel';
import { seasonManagementPath } from './season-management-path';
import { teamRowLines } from './team-row-lines';

const LINE = 'flex items-start gap-1.5 text-sm text-muted-foreground';
const LINE_ICON = 'mt-0.5 shrink-0 text-base';
const PANEL =
  'overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';
const PANEL_HEAD =
  'flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5';
const TILE = `rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 px-3 py-3 md:px-4 md:py-4`;
const TILE_LABEL = 'flex items-center gap-2 text-xs font-medium text-muted-foreground md:text-sm';
const TILE_ICON =
  'hidden size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground md:flex';
const TILE_VALUE = 'mt-1 text-2xl font-semibold tabular-nums md:mt-2';
const EMPTY = 'flex flex-col items-center px-6 py-10 text-center';
const EMPTY_ICON =
  'flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground';
const EMPTY_TEXT = 'mt-1 max-w-xs text-sm text-balance text-muted-foreground';
const CAP_NOTE = 'border-t border-border px-4 py-3 text-sm text-muted-foreground md:px-5';
const PANEL_NOTE = 'border-b border-border px-4 py-3 md:px-5';
const EMAIL_LINK =
  'inline-flex items-center break-all underline underline-offset-4 hover:text-foreground pointer-coarse:min-h-11';

type SeasonFreeAgentId = SeasonFreeAgents['rows'][number]['freeAgentId'];

const twoDigits = (n: number) => String(n).padStart(2, '0');

/** The viewer's own calendar day, as the visible date shows it. */
function localDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

@Component({
  selector: 'app-season-management',
  imports: [
    AdminAlert,
    NgIcon,
    PlaceFreeAgentDialog,
    RouterLink,
    SeasonLimits,
    SeasonWaitlistPanel,
  ],
  providers: [
    provideIcons({
      lucideCalendarClock,
      lucideCalendarDays,
      lucideChevronRight,
      lucideCircleCheck,
      lucideCircleDashed,
      lucideListOrdered,
      lucideMail,
      lucideTriangleAlert,
      lucideUserPlus,
      lucideUserRound,
      lucideUsers,
      lucideUsersRound,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8',
    '[attr.inert]': 'placeOpen() ? "" : null',
  },
  template: `
    @if (league(); as league) {
      @if (season(); as season) {
        <nav aria-label="Breadcrumb">
          <ol
            role="list"
            class="flex flex-nowrap items-center gap-x-1.5 text-sm whitespace-nowrap text-muted-foreground"
          >
            <li [class]="nameCrumb">
              <a [routerLink]="leagueHref()" [class]="leagueCrumbLink"
                ><span class="truncate">{{ league.name }}</span></a
              >
            </li>
            <li aria-hidden="true" class="shrink-0">
              <ng-icon
                name="lucideChevronRight"
                class="translate-y-0.5 text-sm"
                aria-hidden="true"
              />
            </li>
            <li class="flex min-w-16 shrink-100">
              <a [routerLink]="seasonHref()" aria-current="page" [class]="currentCrumbLink"
                ><span class="truncate">{{ season.name }}</span></a
              >
            </li>
          </ol>
        </nav>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          {{ season.name }}
        </h1>
        <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          @if (season.status === 'published') {
            <span data-slot="badge" data-variant="default" [class]="defaultBadge"
              ><ng-icon
                name="lucideCircleCheck"
                data-icon="inline-start"
                aria-hidden="true"
              />Published</span
            >
          } @else {
            <span data-slot="badge" data-variant="outline" [class]="outlineBadge"
              ><ng-icon
                name="lucideCircleDashed"
                data-icon="inline-start"
                aria-hidden="true"
              />Draft</span
            >
          }
          <span data-slot="badge" data-variant="secondary" [class]="secondaryBadge">{{
            sport()
          }}</span>
        </div>
        <div class="mt-2 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
          <p [class]="line">
            <ng-icon name="lucideCalendarDays" [class]="lineIcon" aria-hidden="true" /><span
              ><span class="sr-only">Dates: </span
              >{{ dates(season.startDate, season.endDate) }}</span
            >
          </p>
          <p [class]="line">
            <ng-icon name="lucideCalendarClock" [class]="lineIcon" aria-hidden="true" /><span
              >Registration deadline {{ day(season.registrationDeadline) }}</span
            >
          </p>
          <p [class]="line">
            <ng-icon name="lucideUsers" [class]="lineIcon" aria-hidden="true" /><span
              >{{ season.formatName }} · at least {{ season.minimumRosterSize }} players</span
            >
          </p>
        </div>
        <app-season-limits
          [seasonId]="season.seasonId"
          [maxTeams]="season.maxTeams"
          [teamCount]="season.teamCount"
          [maxRosterSize]="season.maxRosterSize"
          [minimumRosterSize]="season.minimumRosterSize"
          [largestRoster]="season.largestRoster"
          [waitlistCount]="waitlistCount()"
        />
        <dl class="mt-6 grid grid-cols-3 gap-3 md:gap-4">
          <div [class]="tile">
            <dt [class]="tileLabel">
              <span [class]="tileIcon"
                ><ng-icon name="lucideUsersRound" class="text-base" aria-hidden="true" /></span
              >Teams
            </dt>
            <dd [class]="tileValue" data-testid="team-count">
              {{ season.teamCount }}
              @if (season.maxTeams !== undefined) {
                <span class="text-base font-medium text-muted-foreground">
                  of {{ season.maxTeams }}</span
                >
              }
            </dd>
          </div>
          <div [class]="tile">
            <dt [class]="tileLabel">
              <span [class]="tileIcon"
                ><ng-icon name="lucideUserRound" class="text-base" aria-hidden="true" /></span
              >Free agents waiting
            </dt>
            <dd [class]="tileValue" data-testid="free-agent-count">{{ freeAgentCount() }}</dd>
          </div>
          <div [class]="tile">
            <dt [class]="tileLabel">
              <span [class]="tileIcon"
                ><ng-icon name="lucideListOrdered" class="text-base" aria-hidden="true" /></span
              >On the waitlist
            </dt>
            <dd [class]="tileValue" data-testid="waitlist-tile">{{ waitlistTile() }}</dd>
          </div>
        </dl>
        <div class="mt-4 grid items-start gap-4 md:mt-6 md:gap-6 lg:grid-cols-3">
          <section aria-labelledby="teams-heading" [class]="panel + ' lg:col-span-2'">
            <div [class]="panelHead">
              <h2 id="teams-heading" class="font-semibold">Teams</h2>
            </div>
            @if (teams().length > 0) {
              <ul id="teams-list" role="list" class="divide-y divide-border">
                @for (team of teams(); track team.teamId) {
                  <li class="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3.5 md:px-5">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <h3 class="me-1 font-medium">
                          <a [routerLink]="team.path" [class]="rowLink">{{ team.name }}</a>
                        </h3>
                        @if (team.lines.belowMinimum) {
                          <span data-slot="badge" data-variant="outline" [class]="belowMinimumBadge"
                            ><ng-icon
                              name="lucideTriangleAlert"
                              data-icon="inline-start"
                              aria-hidden="true"
                            />Below minimum</span
                          >
                        }
                      </div>
                      <div class="mt-1.5 flex flex-col gap-1">
                        <p [class]="line">
                          <ng-icon
                            name="lucideUserRound"
                            [class]="lineIcon"
                            aria-hidden="true"
                          /><span>Captain: {{ team.captainName }}</span>
                        </p>
                        <p [class]="line">
                          <ng-icon name="lucideUsers" [class]="lineIcon" aria-hidden="true" /><span
                            data-slot="roster"
                            >{{ team.lines.roster }}</span
                          >
                        </p>
                        @if (team.lines.invites; as invites) {
                          <p [class]="line">
                            <ng-icon name="lucideMail" [class]="lineIcon" aria-hidden="true" /><span
                              data-slot="invites"
                              >{{ invites }}</span
                            >
                          </p>
                        }
                      </div>
                    </div>
                  </li>
                }
              </ul>
              @if (season.teamCount > teams().length) {
                <p [class]="capNote">
                  Showing the first {{ teams().length }} of {{ season.teamCount }} teams.
                </p>
              }
            } @else {
              <div [class]="empty">
                <span [class]="emptyIcon"
                  ><ng-icon name="lucideUsersRound" class="text-xl" aria-hidden="true"
                /></span>
                <p class="mt-4 font-medium">No teams yet</p>
                @if (season.status === 'published') {
                  <p [class]="emptyText">Teams appear here when captains register them.</p>
                } @else {
                  <p [class]="emptyText">
                    Teams can register once the season is published.
                    <a
                      [routerLink]="leagueHref()"
                      class="underline underline-offset-4 hover:text-foreground"
                      >Publish it from {{ league.name }}</a
                    >.
                  </p>
                }
              </div>
            }
          </section>
          <app-season-waitlist-panel
            class="lg:col-span-2"
            [waitlist]="waitlist()"
            [teamCount]="season.teamCount"
            [maxTeams]="season.maxTeams"
          />
          <section
            id="free-agents"
            aria-labelledby="free-agents-heading"
            [class]="panel + ' lg:col-start-3 lg:row-span-2 lg:row-start-1'"
          >
            <div [class]="panelHead">
              <h2 id="free-agents-heading" tabindex="-1" class="font-semibold">Free agents</h2>
            </div>
            @if (placed(); as placed) {
              <div [class]="panelNote">
                <app-admin-alert
                  #placedNotice
                  kind="success"
                  [title]="placed.title"
                  [description]="placed.description"
                />
              </div>
            }
            @if (freeAgents(); as freeAgents) {
              @if (freeAgents.rows.length > 0) {
                @if (teams().length === 0) {
                  <div [class]="panelNote">
                    <app-admin-alert
                      kind="info"
                      title="No team to place them on yet"
                      description="Place free agents once a team registers."
                    />
                  </div>
                }
                <ul id="free-agents-list" role="list" class="divide-y divide-border">
                  @for (row of freeAgentRows(); track row.freeAgentId) {
                    <li class="px-4 py-3.5 md:px-5">
                      <h3 class="font-medium">{{ row.name }}</h3>
                      <div class="mt-1 flex flex-col gap-1">
                        <p [class]="line">
                          <ng-icon name="lucideMail" [class]="lineIcon" aria-hidden="true" /><span
                            ><span class="sr-only">Email: </span
                            ><a [href]="row.mailto" [class]="emailLink">{{ row.email }}</a></span
                          >
                        </p>
                        <p [class]="line">
                          <ng-icon
                            name="lucideCalendarDays"
                            [class]="lineIcon"
                            aria-hidden="true"
                          /><span
                            >Registered
                            <time [attr.datetime]="row.datetime">{{ row.registered }}</time></span
                          >
                        </p>
                      </div>
                      @if (teams().length > 0) {
                        <div class="mt-3">
                          <button
                            type="button"
                            aria-haspopup="dialog"
                            data-slot="button"
                            [attr.data-free-agent-id]="row.freeAgentId"
                            [attr.aria-label]="'Place on team: ' + row.name"
                            [class]="outlineButton"
                            (click)="openPlace(row)"
                          >
                            <ng-icon
                              name="lucideUserPlus"
                              data-icon="inline-start"
                              aria-hidden="true"
                            />Place on team
                          </button>
                        </div>
                      }
                    </li>
                  }
                </ul>
                @if (freeAgents.hasMore) {
                  <p [class]="capNote">
                    Showing the {{ freeAgents.rows.length }} who registered first. Place some to see
                    the rest.
                  </p>
                }
              } @else {
                <div [class]="empty">
                  <span [class]="emptyIcon"
                    ><ng-icon name="lucideUserRound" class="text-xl" aria-hidden="true"
                  /></span>
                  <p class="mt-4 font-medium">No free agents waiting</p>
                  <p [class]="emptyText">
                    People who register without a team wait here until you place them on one.
                  </p>
                </div>
              }
            } @else {
              <div class="px-4 py-4 md:px-5">
                <app-admin-alert
                  kind="error"
                  title="The free agents could not be loaded."
                  description="Check your connection and try again."
                />
              </div>
            }
          </section>
        </div>
        <app-place-free-agent-dialog
          [teams]="teams()"
          [minimumRosterSize]="season.minimumRosterSize"
          [maxRosterSize]="season.maxRosterSize"
          (dismissed)="placeDismissed($event)"
        />
      }
    }
  `,
})
export class SeasonManagement {
  private readonly context = inject(SeasonContext);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly league = this.context.league;
  protected readonly season = this.context.season;
  protected readonly freeAgents = this.context.freeAgents;
  protected readonly waitlist = this.context.waitlist;
  protected readonly waitlistCount = computed(() => this.waitlist()?.waitlistCount ?? 0);
  protected readonly waitlistTile = computed(() => {
    const waitlist = this.waitlist();
    return waitlist ? String(waitlist.waitlistCount) : '–';
  });

  protected readonly leagueCrumbLink = LEAGUE_CRUMB_LINK;
  protected readonly currentCrumbLink = CURRENT_CRUMB_LINK;
  protected readonly nameCrumb = NAME_CRUMB;
  protected readonly defaultBadge = BADGE_DEFAULT;
  protected readonly outlineBadge = BADGE_OUTLINE;
  protected readonly secondaryBadge = BADGE_SECONDARY;
  protected readonly belowMinimumBadge = BADGE_OUTLINE_DESTRUCTIVE;
  protected readonly line = LINE;
  protected readonly lineIcon = LINE_ICON;
  protected readonly panel = PANEL;
  protected readonly panelHead = PANEL_HEAD;
  protected readonly tile = TILE;
  protected readonly tileLabel = TILE_LABEL;
  protected readonly tileIcon = TILE_ICON;
  protected readonly tileValue = TILE_VALUE;
  protected readonly empty = EMPTY;
  protected readonly emptyIcon = EMPTY_ICON;
  protected readonly emptyText = EMPTY_TEXT;
  protected readonly capNote = CAP_NOTE;
  protected readonly rowLink = ROW_TITLE_LINK;
  protected readonly emailLink = EMAIL_LINK;
  protected readonly panelNote = PANEL_NOTE;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly dates = seasonDates;
  protected readonly day = formatCalendarDate;

  protected readonly leagueHref = computed(() =>
    leaguePath(this.context.orgSlug(), this.context.leagueSlug()),
  );
  protected readonly seasonHref = computed(() =>
    seasonManagementPath(
      this.context.orgSlug(),
      this.context.leagueSlug(),
      this.context.seasonSlug(),
    ),
  );
  protected readonly sport = computed(() => {
    const league = this.league();
    return league ? sportName(league.sport) : '';
  });

  protected readonly teams = computed(() => {
    const season = this.season();
    if (!season) return [];
    return season.teams.map((team) => ({
      ...team,
      path: teamPath(team.teamId),
      lines: teamRowLines(team.rosterCount, season.minimumRosterSize, team.pendingInviteCount),
    }));
  });

  protected readonly freeAgentRows = computed(() =>
    (this.freeAgents()?.rows ?? []).map((row) => ({
      ...row,
      mailto: `mailto:${row.email}`,
      registered: formatDay(row.registeredAt),
      datetime: localDay(row.registeredAt),
    })),
  );

  private readonly placeDialog = viewChild(PlaceFreeAgentDialog);
  private readonly placedNotice = viewChild<AdminAlert>('placedNotice');
  protected readonly placeOpen = computed(() => this.placeDialog()?.isOpen() ?? false);
  protected readonly placed = signal<AlertText | null>(null);

  protected openPlace(row: { freeAgentId: SeasonFreeAgentId; name: string }): void {
    this.placed.set(null);
    this.placeDialog()?.open({ freeAgentId: row.freeAgentId, name: row.name });
  }

  /** A placement moves focus to the status, because the row and its button are gone; a cancel puts focus back on the row's button, or on the first remaining button or the heading when the row is gone. */
  protected placeDismissed({ freeAgentId, name, placedOn }: PlaceFreeAgentOutcome): void {
    if (placedOn) {
      const minimum = this.season()?.minimumRosterSize ?? 0;
      this.placed.set(placedText(name, placedOn.teamName, placedOn.rosterCount, minimum));
      afterNextRender(() => this.placedNotice()?.focus(), { injector: this.injector });
      return;
    }
    afterNextRender(
      () => {
        const host: HTMLElement = this.host.nativeElement;
        const target =
          host.querySelector<HTMLElement>(`button[data-free-agent-id="${freeAgentId}"]`) ??
          host.querySelector<HTMLElement>('#free-agents-list button[data-free-agent-id]') ??
          host.querySelector<HTMLElement>('#free-agents-heading');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  protected readonly freeAgentCount = computed(() => {
    const freeAgents = this.freeAgents();
    if (!freeAgents) return '–';
    return freeAgents.hasMore ? `${freeAgents.rows.length}+` : String(freeAgents.rows.length);
  });
}
