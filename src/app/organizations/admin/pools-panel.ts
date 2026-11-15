import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
  lucideArrowDown,
  lucideArrowUp,
  lucideRefreshCw,
  lucideShuffle,
  lucideUndo2,
  lucideUsersRound,
} from '@ng-icons/lucide';
import type { FunctionReturnType } from 'convex/server';
import {
  POOL_MESSAGES,
  checkPoolSizes,
  poolCountsFor,
  poolSizesAfterMove,
  type Pool,
} from '../../../../convex/lib/pools';
import { registrationIsOpen } from '../../../../convex/lib/registration';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { injectNow } from '../../core/now';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import type { AlertText } from './alert-text';
import {
  bracketRefusalMessage,
  emptySeedsText,
  movedText,
  moveFailedText,
  moveOfflineText,
  playersText,
  type SeedDirection,
} from './bracket-text';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { ConfirmDialog, type ConfirmAlertView } from './confirm-dialog';
import {
  gamesCreatedText,
  gamesFailedText,
  gamesOfflineText,
  moveToPoolFailedText,
  moveToPoolOfflineText,
  movedToPoolText,
  splitDoneText,
  splitFailedText,
  splitOfflineText,
  SPLIT_RESTORED_TEXT,
  STALE_GAMES_NOTE,
  teamsText,
  unassignedNote,
  unconfirmedPoolNote,
  undoSplitFailedText,
  undoSplitOfflineText,
} from './pool-text';
import type { ManagedTournament, PoolsView } from './tournament-context';

const PANEL = 'overflow-hidden';
const PANEL_HEAD =
  'flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5';
const PANEL_NOTE = 'border-b border-border px-4 py-3 md:px-5';
const SECTION = 'border-t border-border px-4 py-4 md:px-5';
const HINT = 'text-sm text-muted-foreground';

type SplitUndo = FunctionReturnType<typeof api.tournamentGames.splitPools>['undo'];

type Notice =
  | { kind: 'done'; text: AlertText; undo?: SplitUndo }
  | { kind: 'failed'; text: AlertText }
  | { kind: 'offline'; description: string };

interface SeedRow {
  teamId: Id<'teams'>;
  name: string;
  seed: number;
  first: boolean;
  last: boolean;
}

interface MoveTarget {
  pool: Pool;
  teamId: Id<'teams'>;
  name: string;
}

@Component({
  selector: 'app-pools-panel',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    ChipRadioGroup,
    ConfirmDialog,
    HlmCard,
    HlmSkeleton,
    HlmSpinner,
    MousePressKeepsFocus,
    NgIcon,
  ],
  providers: [
    provideIcons({
      lucideArrowDown,
      lucideArrowUp,
      lucideRefreshCw,
      lucideShuffle,
      lucideUndo2,
      lucideUsersRound,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section hlmCard size="bare" id="pools" aria-labelledby="pools-heading" [class]="panel">
      <div [class]="panelHead">
        <h2 id="pools-heading" tabindex="-1" class="font-semibold focus:outline-none">Pools</h2>
        @if (confirmedCount() > 0) {
          <p class="text-sm text-muted-foreground tabular-nums" data-slot="team-count">
            {{ confirmedCount() }} {{ confirmedCount() === 1 ? 'team' : 'teams' }}
          </p>
        }
      </div>
      @if (notice(); as notice) {
        <div [class]="panelNote">
          @if (notice.kind === 'offline') {
            <app-admin-offline-alert #noticeAlert [description]="notice.description" />
          } @else {
            <app-admin-alert
              #noticeAlert
              [kind]="notice.kind === 'done' ? 'success' : 'error'"
              [title]="notice.text.title"
              [description]="notice.text.description"
            >
              @if (undoOf(notice); as undo) {
                <button
                  type="button"
                  appMousePressKeepsFocus
                  data-slot="undo-split"
                  class="inline-flex items-center gap-1 rounded-md font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                  [class.opacity-50]="!online() && !undoing()"
                  [attr.aria-disabled]="busy() || !online() ? 'true' : null"
                  (click)="undoSplit(undo)"
                >
                  <ng-icon name="lucideUndo2" class="text-base" aria-hidden="true" />{{
                    undoing() ? 'Undoing…' : 'Undo'
                  }}
                </button>
              }
            </app-admin-alert>
          }
        </div>
      }
      @switch (view().status) {
        @case ('loading') {
          <div aria-hidden="true" class="divide-y divide-border">
            @for (row of skeletonRows; track row) {
              <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                <div hlmSkeleton aria-hidden="true" class="size-9 shrink-0 rounded-lg"></div>
                <div class="flex-1">
                  <div hlmSkeleton aria-hidden="true" class="rounded-md h-5 w-40 max-w-full"></div>
                  <div hlmSkeleton aria-hidden="true" class="rounded-md mt-2 h-4 w-20"></div>
                </div>
              </div>
            }
          </div>
          <p role="status" class="sr-only">Loading the pools.</p>
        }
        @case ('error') {
          <div class="px-4 py-4 md:px-5">
            <app-admin-alert
              kind="error"
              title="The pools could not be loaded."
              description="Check your connection and try again."
              ><a [href]="retryHref()" [class]="retryLink">Try again</a></app-admin-alert
            >
          </div>
        }
        @default {
          @if (confirmedCount() === 0) {
            <div data-slot="empty" class="flex flex-col items-center px-6 py-10 text-center">
              <span
                class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                ><ng-icon name="lucideUsersRound" class="text-xl" aria-hidden="true"
              /></span>
              <p class="mt-4 font-medium">No confirmed teams yet</p>
              <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                {{ emptyText() }}
              </p>
              <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                {{ teamLimits }}
              </p>
            </div>
          } @else {
            @if (splitReason(); as reason) {
              <p [class]="hint + ' px-4 py-4 md:px-5'" data-slot="split-reason">{{ reason }}</p>
            } @else {
              <form class="px-4 py-4 md:px-5" (submit)="split($event)">
                <app-chip-radio-group
                  name="pool-count"
                  legend="Number of pools"
                  [options]="poolCountOptions()"
                  [value]="'' + poolCount()"
                  description="Each pool holds 3 to 8 teams. Teams are placed in snake order of the seeds."
                  (chosen)="choosePoolCount($event)"
                />
                <button
                  type="submit"
                  id="split-pools"
                  data-slot="button"
                  [class]="primaryButton + ' mt-4'"
                  [class.opacity-50]="!online() && !splitting()"
                  [attr.aria-disabled]="busy() || !online() ? 'true' : null"
                >
                  @if (splitting()) {
                    <hlm-spinner data-icon="inline-start" />Splitting…
                  } @else {
                    <ng-icon name="lucideShuffle" data-icon="inline-start" aria-hidden="true" />{{
                      hasPools() ? 'Split again' : 'Split into pools'
                    }}
                  }
                </button>
              </form>
            }
            @if (unconfirmed(); as note) {
              <p
                [class]="hint + ' border-t border-border px-4 py-3 md:px-5'"
                data-slot="unconfirmed"
              >
                {{ note }}
              </p>
            }
            @if (seedRows().length > 1) {
              <section aria-labelledby="pool-seeds-heading" [class]="section" data-slot="seeds">
                <h3 id="pool-seeds-heading" class="font-semibold">Seeds</h3>
                @if (canMove()) {
                  <p [class]="hint + ' mt-1'">
                    {{ hasPools() ? staleSeedsHint : seedsHint }}
                  </p>
                }
                <p role="status" data-slot="seed-status" class="min-h-5 pt-2 text-sm font-medium">
                  {{ seedAnnouncement() }}
                </p>
                <ol
                  id="pool-seed-list"
                  role="list"
                  class="mt-2 divide-y divide-border border-t border-b border-border"
                >
                  @for (row of seedRows(); track row.teamId) {
                    <li class="flex items-start gap-3 py-3" [attr.data-seed-team]="row.teamId">
                      <span
                        class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold tabular-nums"
                        ><span class="sr-only">Seed </span>{{ row.seed }}</span
                      >
                      <div class="min-w-0 flex-1">
                        <h4 class="font-medium">{{ row.name }}</h4>
                        @if (canMove()) {
                          <div class="mt-3 flex flex-wrap gap-2">
                            @for (direction of directions; track direction) {
                              <button
                                type="button"
                                data-slot="button"
                                [attr.data-move]="direction"
                                [class]="outlineButton"
                                [class.opacity-50]="!online() && !busy()"
                                [attr.aria-disabled]="
                                  seedMoveDisabled(row, direction) ? 'true' : null
                                "
                                (click)="moveSeed(row, direction, $event)"
                              >
                                @if (isSeedMoving(row, direction)) {
                                  <hlm-spinner data-icon="inline-start" />Moving…<span
                                    class="sr-only"
                                  >
                                    {{ row.name }}</span
                                  >
                                } @else {
                                  <ng-icon
                                    [name]="
                                      direction === 'up' ? 'lucideArrowUp' : 'lucideArrowDown'
                                    "
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />Move {{ direction }}<span class="sr-only"> {{ row.name }}</span>
                                }
                              </button>
                            }
                          </div>
                        }
                      </div>
                    </li>
                  }
                </ol>
              </section>
            }
            <p
              role="status"
              data-slot="pool-status"
              class="min-h-5 px-4 pt-3 text-sm font-medium md:px-5"
            >
              {{ announcement() }}
            </p>
            @for (pool of pools(); track pool.pool) {
              <section
                [attr.aria-labelledby]="'pool-' + pool.pool"
                [attr.data-pool]="pool.pool"
                [class]="section"
              >
                <div class="flex items-baseline justify-between gap-3">
                  <h3 [id]="'pool-' + pool.pool" class="font-semibold">Pool {{ pool.pool }}</h3>
                  <p [class]="hint + ' tabular-nums'">{{ teamsOf(pool.teams.length) }}</p>
                </div>
                <ol role="list" class="mt-3 divide-y divide-border border-t border-b border-border">
                  @for (team of pool.teams; track team.teamId) {
                    <li class="flex items-start gap-3 py-3" [attr.data-team-id]="team.teamId">
                      <span
                        class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold tabular-nums"
                        ><span class="sr-only">Seed </span>{{ team.seed }}</span
                      >
                      <div class="min-w-0 flex-1">
                        <h4 class="font-medium">{{ team.name }}</h4>
                        <p [class]="hint" data-slot="players">{{ playersOf(team.rosterCount) }}</p>
                        @if (canMove()) {
                          <div class="mt-3 flex flex-wrap gap-2">
                            @for (target of targetsFor(pool.pool, team); track target.pool) {
                              <button
                                type="button"
                                data-slot="button"
                                [attr.data-move-to]="target.pool"
                                [class]="outlineButton"
                                [class.opacity-50]="!online() && moving() === null"
                                [attr.aria-disabled]="busy() || !online() ? 'true' : null"
                                (click)="move(target, $event)"
                              >
                                @if (isMoving(target)) {
                                  <hlm-spinner data-icon="inline-start" />Moving…<span
                                    class="sr-only"
                                  >
                                    {{ team.name }}</span
                                  >
                                } @else {
                                  Move to Pool {{ target.pool
                                  }}<span class="sr-only"> {{ team.name }}</span>
                                }
                              </button>
                            }
                          </div>
                        }
                      </div>
                    </li>
                  }
                </ol>
                @if (pool.games.length > 0) {
                  <h4 class="mt-4 text-sm font-medium text-muted-foreground">
                    Games in Pool {{ pool.pool }}
                  </h4>
                  <ol role="list" class="mt-2 flex flex-col gap-1.5" data-slot="pool-games">
                    @for (game of pool.games; track game.gameId) {
                      <li class="text-sm" data-slot="pool-game">
                        <span class="text-muted-foreground tabular-nums"
                          >Round {{ game.round }}</span
                        >: {{ game.teams[0]?.name }} v {{ game.teams[1]?.name }}
                      </li>
                    }
                  </ol>
                }
              </section>
            }
            @if (unassignedCount() > 0 && hasPools()) {
              <p
                [class]="hint + ' border-t border-border px-4 py-3 md:px-5'"
                data-slot="unassigned"
              >
                {{ unassignedText() }}
              </p>
            }
            @if (hasPools() && stale()) {
              <p
                [class]="hint + ' border-t border-border px-4 py-3 md:px-5'"
                data-slot="stale-note"
              >
                {{ staleNote }}
              </p>
            }
            <div [class]="section">
              @if (gamesReason(); as reason) {
                <p [class]="hint" data-slot="games-reason">{{ reason }}</p>
              } @else {
                <button
                  type="button"
                  id="create-pool-games"
                  data-slot="button"
                  [class]="primaryButton"
                  [class.opacity-50]="!online() && !creating()"
                  [attr.aria-disabled]="busy() || !online() ? 'true' : null"
                  (click)="create()"
                >
                  @if (creating()) {
                    <hlm-spinner data-icon="inline-start" />{{
                      hasGames() ? 'Recreating…' : 'Creating…'
                    }}
                  } @else {
                    <ng-icon
                      [name]="hasGames() ? 'lucideRefreshCw' : 'lucideUsersRound'"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />{{ hasGames() ? 'Recreate pool games' : 'Create pool games' }}
                  }
                </button>
              }
              <p role="status" class="sr-only">
                {{ creating() ? 'Creating the pool games.' : '' }}
              </p>
            </div>
          }
        }
      }
    </section>
    <app-confirm-dialog
      icon="lucideRefreshCw"
      cancelId="recreate-pool-games-cancel"
      heading="Recreate the pool games?"
      confirmLabel="Recreate pool games"
      pendingLabel="Recreating…"
      [pending]="creating()"
      [alert]="dialogAlert()"
      (confirmed)="recreate()"
      (closed)="dialogClosed()"
    >
      <p>The pool games are replaced using the pools above. No pool result has been entered.</p>
    </app-confirm-dialog>
  `,
})
export class PoolsPanel {
  readonly tournament = input.required<ManagedTournament>();
  readonly view = input.required<PoolsView>();
  readonly retryHref = input.required<string>();

  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly splitCall = injectMutation(api.tournamentGames.splitPools);
  private readonly moveCall = injectMutation(api.tournamentGames.movePoolTeam);
  private readonly createCall = injectMutation(api.tournamentGames.createPoolGames);
  private readonly undoSplitCall = injectMutation(api.tournamentGames.undoSplitPools);
  private readonly moveSeedCall = injectMutation(api.tournamentGames.moveSeed);
  private readonly now = injectNow();
  protected readonly online = injectOnline();

  protected readonly panel = PANEL;
  protected readonly panelHead = PANEL_HEAD;
  protected readonly panelNote = PANEL_NOTE;
  protected readonly section = SECTION;
  protected readonly hint = HINT;
  protected readonly retryLink =
    'underline underline-offset-4 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center';
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly teamLimits = POOL_MESSAGES.teamLimits;
  protected readonly staleNote = STALE_GAMES_NOTE;
  protected readonly skeletonRows = [1, 2, 3];

  protected readonly directions: readonly SeedDirection[] = ['up', 'down'];
  protected readonly seedsHint =
    'Seed 1 goes in Pool A first. Move a team up or down to set the order, then split.';
  protected readonly staleSeedsHint =
    'The pools keep the seeds they were split with. Split again to use this order.';

  protected readonly moving = signal<MoveTarget | null>(null);
  protected readonly seedMoving = signal<{ teamId: Id<'teams'>; direction: SeedDirection } | null>(
    null,
  );
  protected readonly seedAnnouncement = signal('');
  protected readonly undoing = signal(false);
  protected readonly splitting = signal(false);
  protected readonly creating = signal(false);
  protected readonly announcement = signal('');
  protected readonly notice = signal<Notice | null>(null);
  protected readonly dialogAlert = signal<ConfirmAlertView | null>(null);
  private readonly chosenCount = signal<number | null>(null);

  private readonly noticeAlert = viewChild<AdminAlert | AdminOfflineAlert>('noticeAlert');
  private readonly dialog = viewChild.required(ConfirmDialog);

  readonly dialogOpen = computed(() => this.dialog().isOpen());

  private readonly setup = computed(() => {
    const view = this.view();
    return view.status === 'ready' ? view.setup : null;
  });
  protected readonly confirmedCount = computed(() => this.setup()?.confirmedCount ?? 0);
  protected readonly pools = computed(() => this.setup()?.pools ?? []);
  protected readonly hasPools = computed(() => this.pools().length > 0);
  protected readonly unassignedCount = computed(() => this.setup()?.unassigned.length ?? 0);
  protected readonly hasGames = computed(() => this.setup()?.gamesCreated ?? false);
  protected readonly stale = computed(
    () => this.hasGames() && !(this.setup()?.gamesCurrent ?? true),
  );
  private readonly hasResult = computed(() => this.setup()?.hasResult ?? false);
  protected readonly canMove = computed(() => !this.hasResult());
  protected readonly busy = computed(
    () =>
      this.moving() !== null ||
      this.seedMoving() !== null ||
      this.splitting() ||
      this.creating() ||
      this.undoing(),
  );
  protected readonly seedRows = computed<SeedRow[]>(() => {
    const seeds = this.setup()?.seeds ?? [];
    return seeds.map((team, index) => ({
      teamId: team.teamId,
      name: team.name,
      seed: index + 1,
      first: index === 0,
      last: index === seeds.length - 1,
    }));
  });

  private readonly poolCounts = computed(() => poolCountsFor(this.confirmedCount()));
  protected readonly poolCountOptions = computed<ChipOption[]>(() =>
    this.poolCounts().map((count) => ({ key: `${count}`, label: `${count} pools` })),
  );
  /** The choice if it still fits, else the pools already made, else the fewest pools. */
  protected readonly poolCount = computed(() => {
    const counts = this.poolCounts();
    const chosen = this.chosenCount();
    if (chosen !== null && counts.includes(chosen)) return chosen;
    const made = this.pools().length;
    return counts.includes(made) ? made : (counts[0] ?? made);
  });

  protected readonly emptyText = computed(() =>
    emptySeedsText(this.tournament().minimumRosterSize),
  );
  protected readonly unconfirmed = computed(() => {
    const count = this.setup()?.unconfirmedCount ?? 0;
    return count > 0 ? unconfirmedPoolNote(count, this.tournament().minimumRosterSize) : null;
  });
  protected readonly unassignedText = computed(() => unassignedNote(this.unassignedCount()));

  protected readonly splitReason = computed(() => {
    if (this.poolCounts().length === 0) return POOL_MESSAGES.teamLimits;
    const tournament = this.tournament();
    if (this.hasResult()) return POOL_MESSAGES.poolResultEntered;
    if (registrationIsOpen(tournament, this.now())) {
      return POOL_MESSAGES.poolRegistrationOpen(tournament.registrationDeadline);
    }
    return null;
  });

  protected readonly gamesReason = computed(() => {
    if (this.splitReason()) return this.splitReason();
    if (!this.hasPools() || this.unassignedCount() > 0) return POOL_MESSAGES.notSplit;
    return null;
  });

  protected playersOf(rosterCount: number): string {
    return playersText(rosterCount);
  }

  protected teamsOf(count: number): string {
    return teamsText(count);
  }

  protected undoOf(notice: Notice): SplitUndo | null {
    return notice.kind === 'done' ? (notice.undo ?? null) : null;
  }

  protected targetsFor(own: Pool, team: { teamId: Id<'teams'>; name: string }): MoveTarget[] {
    const pools = this.pools();
    const sizes = pools.map((pool) => pool.teams.length);
    const from = pools.findIndex((pool) => pool.pool === own);
    return pools
      .map((pool, to) => ({ pool: pool.pool, to }))
      .filter(
        ({ to }) => to !== from && checkPoolSizes(poolSizesAfterMove(sizes, from, to)) === null,
      )
      .map(({ pool }) => ({ pool, teamId: team.teamId, name: team.name }));
  }

  protected seedMoveDisabled(row: SeedRow, direction: SeedDirection): boolean {
    const atEnd = direction === 'up' ? row.first : row.last;
    return atEnd || this.busy() || !this.online();
  }

  protected isSeedMoving(row: SeedRow, direction: SeedDirection): boolean {
    const moving = this.seedMoving();
    return moving?.teamId === row.teamId && moving.direction === direction;
  }

  protected isMoving(target: MoveTarget): boolean {
    const moving = this.moving();
    return moving?.teamId === target.teamId && moving.pool === target.pool;
  }

  protected choosePoolCount(key: string): void {
    this.chosenCount.set(Number(key));
  }

  protected async split(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.notice.set(null);
    this.announcement.set('');
    if (!this.online()) {
      this.show({ kind: 'offline', description: splitOfflineText() });
      return;
    }
    this.splitting.set(true);
    try {
      const { poolCount, teamCount, undo } = await this.splitCall.run({
        tournamentId: this.tournament().tournamentId,
        poolCount: this.poolCount(),
      });
      this.notice.set({ kind: 'done', text: splitDoneText(poolCount, teamCount), undo });
    } catch (error) {
      this.show(
        error instanceof ConvexOfflineError
          ? { kind: 'offline', description: splitOfflineText() }
          : { kind: 'failed', text: splitFailedText(bracketRefusalMessage(error)) },
      );
    } finally {
      this.splitting.set(false);
    }
  }

  protected async undoSplit(undo: SplitUndo): Promise<void> {
    if (this.busy()) return;
    if (!this.online()) {
      this.show({ kind: 'offline', description: undoSplitOfflineText() });
      return;
    }
    this.undoing.set(true);
    try {
      await this.undoSplitCall.run({ tournamentId: this.tournament().tournamentId, ...undo });
      this.notice.set({ kind: 'done', text: SPLIT_RESTORED_TEXT });
      // The Undo button that had focus is gone.
      afterNextRender(() => this.noticeAlert()?.focus(), { injector: this.injector });
    } catch (error) {
      this.show(
        error instanceof ConvexOfflineError
          ? { kind: 'offline', description: undoSplitOfflineText() }
          : { kind: 'failed', text: undoSplitFailedText(bracketRefusalMessage(error)) },
      );
    } finally {
      this.undoing.set(false);
    }
  }

  protected async moveSeed(row: SeedRow, direction: SeedDirection, event: Event): Promise<void> {
    if (this.busy() || (direction === 'up' ? row.first : row.last)) return;
    const button = event.currentTarget as HTMLElement;
    this.announcement.set('');
    this.seedAnnouncement.set('');
    this.notice.set(null);
    if (!this.online()) {
      this.show({ kind: 'offline', description: moveOfflineText(row.name) });
      return;
    }
    this.seedMoving.set({ teamId: row.teamId, direction });
    try {
      const { seed, seedCount } = await this.moveSeedCall.run({
        tournamentId: this.tournament().tournamentId,
        teamId: row.teamId,
        direction,
      });
      this.seedAnnouncement.set(movedText(row.name, direction, seed, seedCount));
      this.refocusUnlessMoved(
        button,
        `[data-seed-team="${row.teamId}"] [data-move="${direction}"]`,
      );
    } catch (error) {
      this.show(
        error instanceof ConvexOfflineError
          ? { kind: 'offline', description: moveOfflineText(row.name) }
          : { kind: 'failed', text: moveFailedText(row.name, bracketRefusalMessage(error)) },
      );
    } finally {
      this.seedMoving.set(null);
    }
  }

  protected async move(target: MoveTarget, event: Event): Promise<void> {
    if (this.busy()) return;
    const button = event.currentTarget as HTMLElement;
    this.announcement.set('');
    this.seedAnnouncement.set('');
    this.notice.set(null);
    if (!this.online()) {
      this.show({ kind: 'offline', description: moveToPoolOfflineText(target.name) });
      return;
    }
    this.moving.set(target);
    try {
      const { pool, poolTeamCount } = await this.moveCall.run({
        tournamentId: this.tournament().tournamentId,
        teamId: target.teamId,
        pool: target.pool,
      });
      this.announcement.set(movedToPoolText(target.name, pool, poolTeamCount));
      this.refocusUnlessMoved(button, `[data-team-id="${target.teamId}"] [data-move-to]`);
    } catch (error) {
      this.show(
        error instanceof ConvexOfflineError
          ? { kind: 'offline', description: moveToPoolOfflineText(target.name) }
          : {
              kind: 'failed',
              text: moveToPoolFailedText(target.name, bracketRefusalMessage(error)),
            },
      );
    } finally {
      this.moving.set(null);
    }
  }

  protected async create(): Promise<void> {
    if (this.busy()) return;
    this.notice.set(null);
    this.announcement.set('');
    if (this.hasGames()) {
      this.dialogAlert.set(null);
      this.dialog().open();
      return;
    }
    if (!this.online()) {
      this.show({ kind: 'offline', description: gamesOfflineText(false) });
      return;
    }
    await this.send(false);
  }

  protected async recreate(): Promise<void> {
    if (this.creating()) return;
    this.dialogAlert.set(null);
    if (!this.online()) {
      return this.failInDialog({ kind: 'offline', description: gamesOfflineText(true) });
    }
    if (!(await this.send(true))) return;
    this.dialog().close();
  }

  protected dialogClosed(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#create-pool-games')?.focus(),
      { injector: this.injector },
    );
  }

  private async send(replace: boolean): Promise<boolean> {
    this.creating.set(true);
    try {
      const result = await this.createCall.run({
        tournamentId: this.tournament().tournamentId,
        ...(replace && { replace }),
      });
      this.notice.set({
        kind: 'done',
        text: gamesCreatedText(result.replaced, result.gameCount, this.pools().length),
      });
      return true;
    } catch (error) {
      const offline = error instanceof ConvexOfflineError;
      const text = gamesFailedText(replace, bracketRefusalMessage(error));
      const description = gamesOfflineText(replace);
      if (replace) {
        this.failInDialog(offline ? { kind: 'offline', description } : { kind: 'failed', ...text });
      } else {
        this.show(offline ? { kind: 'offline', description } : { kind: 'failed', text });
      }
      return false;
    } finally {
      this.creating.set(false);
    }
  }

  private failInDialog(alert: ConfirmAlertView): void {
    this.dialogAlert.set(alert);
    this.dialog().focusAlert();
  }

  /** A failure or an offline answer takes focus, because it often sits away from the control that was pressed. */
  private show(notice: Notice): void {
    this.notice.set(notice);
    if (notice.kind === 'done') return;
    afterNextRender(() => this.noticeAlert()?.focus(), { injector: this.injector });
  }

  /** A moved team's row can be a new element, so focus goes to its button again; a reply that arrives after the user went elsewhere leaves focus there. */
  private refocusUnlessMoved(button: HTMLElement, selector: string): void {
    afterNextRender(
      () => {
        const active = this.document.activeElement;
        if (active !== null && active !== this.document.body && active !== button) return;
        this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this.injector },
    );
  }
}
