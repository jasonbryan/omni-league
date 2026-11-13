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
  lucideListOrdered,
  lucideRefreshCw,
  lucideTrophy,
} from '@ng-icons/lucide';
import { BRACKET_MESSAGES, MIN_BRACKET_TEAMS, roundCount } from '../../../../convex/lib/bracket';
import { registrationIsOpen } from '../../../../convex/lib/registration';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { injectNow } from '../../core/now';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import type { AlertText } from './alert-text';
import {
  bracketRefusalMessage,
  createdText,
  createFailedText,
  createOfflineText,
  emptySeedsText,
  moveFailedText,
  movedText,
  moveOfflineText,
  playersText,
  unconfirmedNote,
  type SeedDirection,
} from './bracket-text';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { ConfirmDialog, type ConfirmAlertView } from './confirm-dialog';
import type { BracketView, ManagedTournament } from './tournament-context';

const PANEL = 'overflow-hidden';
const PANEL_HEAD =
  'flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5';
const PANEL_NOTE = 'border-b border-border px-4 py-3 md:px-5';
const SECTION = 'border-t border-border px-4 py-4 md:px-5';
const HINT = 'text-sm text-muted-foreground';

type Notice =
  | { kind: 'created'; text: AlertText }
  | { kind: 'failed'; text: AlertText }
  | { kind: 'offline'; description: string };

interface SeedRow {
  teamId: Id<'teams'>;
  name: string;
  seed: number;
  players: string;
  first: boolean;
  last: boolean;
}

@Component({
  selector: 'app-bracket-panel',
  imports: [AdminAlert, AdminOfflineAlert, ConfirmDialog, HlmCard, HlmSkeleton, HlmSpinner, NgIcon],
  providers: [
    provideIcons({
      lucideArrowDown,
      lucideArrowUp,
      lucideListOrdered,
      lucideRefreshCw,
      lucideTrophy,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section hlmCard size="bare" id="bracket" aria-labelledby="bracket-heading" [class]="panel">
      <div [class]="panelHead">
        <h2 id="bracket-heading" tabindex="-1" class="font-semibold focus:outline-none">
          Seeds and bracket
        </h2>
        @if (seeds().length > 0) {
          <p class="text-sm text-muted-foreground tabular-nums" data-slot="seed-count">
            {{ seeds().length }} {{ seeds().length === 1 ? 'team' : 'teams' }}
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
              [kind]="notice.kind === 'created' ? 'success' : 'error'"
              [title]="notice.text.title"
              [description]="notice.text.description"
            />
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
          <p role="status" class="sr-only">Loading the seeds.</p>
        }
        @case ('error') {
          <div class="px-4 py-4 md:px-5">
            <app-admin-alert
              kind="error"
              title="The seeds could not be loaded."
              description="Check your connection and try again."
              ><a [href]="retryHref()" [class]="retryLink">Try again</a></app-admin-alert
            >
          </div>
        }
        @default {
          @if (seeds().length === 0) {
            <div data-slot="empty" class="flex flex-col items-center px-6 py-10 text-center">
              <span
                class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                ><ng-icon name="lucideListOrdered" class="text-xl" aria-hidden="true"
              /></span>
              <p class="mt-4 font-medium">No confirmed teams yet</p>
              <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                {{ emptyText() }}
              </p>
              <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                {{ tooFewTeams }}
              </p>
            </div>
          } @else {
            @if (canMove()) {
              <p [class]="hint + ' px-4 pt-4 md:px-5'">
                Seed 1 meets the lowest seed first. Move a team up or down to set the order.
              </p>
            }
            <p
              role="status"
              data-slot="seed-status"
              class="min-h-5 px-4 pt-2 text-sm font-medium md:px-5"
            >
              {{ announcement() }}
            </p>
            <ol
              id="seed-list"
              role="list"
              class="mt-2 divide-y divide-border border-t border-border"
            >
              @for (row of rows(); track row.teamId) {
                <li class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                  <span
                    class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold tabular-nums"
                    ><span class="sr-only">Seed </span>{{ row.seed }}</span
                  >
                  <div class="min-w-0 flex-1">
                    <h3 class="font-medium">{{ row.name }}</h3>
                    <p [class]="hint" data-slot="players">{{ row.players }}</p>
                    @if (canMove()) {
                      <div class="mt-3 flex flex-wrap gap-2">
                        @for (direction of directions; track direction) {
                          <button
                            type="button"
                            data-slot="button"
                            [attr.data-move]="direction"
                            [class]="outlineButton"
                            [class.opacity-50]="!online() && moving() === null"
                            [attr.aria-disabled]="moveDisabled(row, direction) ? 'true' : null"
                            (click)="move(row, direction, $event)"
                          >
                            @if (isMoving(row, direction)) {
                              <hlm-spinner data-icon="inline-start" />Moving…<span class="sr-only">
                                {{ row.name }}</span
                              >
                            } @else {
                              <ng-icon
                                [name]="direction === 'up' ? 'lucideArrowUp' : 'lucideArrowDown'"
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
            @if (unconfirmed(); as note) {
              <p
                [class]="hint + ' border-t border-border px-4 py-3 md:px-5'"
                data-slot="unconfirmed"
              >
                {{ note }}
              </p>
            }
            @if (hasBracket() && canMove()) {
              <p [class]="hint + ' border-t border-border px-4 py-3 md:px-5'" data-slot="seed-note">
                The bracket keeps the seeds it was created with. Recreate it to use this order.
              </p>
            }
            <div [class]="section">
              @if (reason(); as reason) {
                <p [class]="hint" data-slot="create-reason">{{ reason }}</p>
              } @else {
                <button
                  type="button"
                  id="create-bracket"
                  data-slot="button"
                  [class]="primaryButton"
                  [class.opacity-50]="!online() && !creating()"
                  [attr.aria-disabled]="creating() || !online() ? 'true' : null"
                  (click)="create()"
                >
                  @if (creating()) {
                    <hlm-spinner data-icon="inline-start" />{{
                      hasBracket() ? 'Recreating…' : 'Creating…'
                    }}
                  } @else {
                    <ng-icon
                      [name]="hasBracket() ? 'lucideRefreshCw' : 'lucideTrophy'"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />{{ hasBracket() ? 'Recreate bracket' : 'Create bracket' }}
                  }
                </button>
              }
              <p role="status" class="sr-only">{{ creating() ? 'Creating the bracket.' : '' }}</p>
            </div>
            @if (rounds(); as rounds) {
              <div id="bracket-rounds" [class]="section">
                <h3 class="font-semibold">Bracket</h3>
                @for (round of rounds; track round.round) {
                  <section [attr.aria-labelledby]="'round-' + round.round" class="mt-4">
                    <h4
                      [id]="'round-' + round.round"
                      class="text-sm font-medium text-muted-foreground"
                    >
                      {{ round.name }}
                    </h4>
                    <ol role="list" class="mt-2 flex flex-col gap-2">
                      @for (game of round.games; track game.gameId) {
                        <li class="rounded-lg border border-border px-3 py-2 text-sm">
                          <span class="sr-only">Game {{ game.slot }}: </span>{{ game.label }}
                        </li>
                      }
                    </ol>
                  </section>
                }
              </div>
            }
          }
        }
      }
    </section>
    <app-confirm-dialog
      icon="lucideRefreshCw"
      cancelId="recreate-cancel"
      heading="Recreate the bracket?"
      confirmLabel="Recreate bracket"
      pendingLabel="Recreating…"
      [pending]="creating()"
      [alert]="dialogAlert()"
      (confirmed)="recreate()"
      (closed)="dialogClosed()"
    >
      <p>The bracket is replaced using the seeds above. No result has been entered.</p>
    </app-confirm-dialog>
  `,
})
export class BracketPanel {
  readonly tournament = input.required<ManagedTournament>();
  readonly view = input.required<BracketView>();
  readonly retryHref = input.required<string>();

  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly moveSeed = injectMutation(api.tournamentGames.moveSeed);
  private readonly createBracket = injectMutation(api.tournamentGames.createBracket);
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
  protected readonly tooFewTeams = BRACKET_MESSAGES.tooFewTeams;
  protected readonly directions: readonly SeedDirection[] = ['up', 'down'];
  protected readonly skeletonRows = [1, 2, 3];

  protected readonly moving = signal<{ teamId: Id<'teams'>; direction: SeedDirection } | null>(
    null,
  );
  protected readonly creating = signal(false);
  protected readonly announcement = signal('');
  protected readonly notice = signal<Notice | null>(null);
  protected readonly dialogAlert = signal<ConfirmAlertView | null>(null);

  private readonly noticeAlert = viewChild<AdminAlert | AdminOfflineAlert>('noticeAlert');
  private readonly dialog = viewChild.required(ConfirmDialog);

  readonly dialogOpen = computed(() => this.dialog().isOpen());

  private readonly setup = computed(() => {
    const view = this.view();
    return view.status === 'ready' ? view.setup : null;
  });
  protected readonly seeds = computed(() => this.setup()?.seeds ?? []);
  private readonly bracket = computed(() => this.setup()?.bracket ?? null);
  protected readonly hasBracket = computed(() => this.bracket() !== null);
  private readonly hasResult = computed(() => this.bracket()?.hasResult ?? false);
  protected readonly canMove = computed(() => this.seeds().length > 1 && !this.hasResult());
  protected readonly busy = computed(() => this.moving() !== null || this.creating());

  protected readonly rows = computed<SeedRow[]>(() => {
    const seeds = this.seeds();
    return seeds.map((team, index) => ({
      teamId: team.teamId,
      name: team.name,
      seed: index + 1,
      players: playersText(team.rosterCount),
      first: index === 0,
      last: index === seeds.length - 1,
    }));
  });
  protected readonly emptyText = computed(() =>
    emptySeedsText(this.tournament().minimumRosterSize),
  );
  protected readonly unconfirmed = computed(() => {
    const count = this.setup()?.unconfirmedCount ?? 0;
    return count > 0 ? unconfirmedNote(count, this.tournament().minimumRosterSize) : null;
  });

  /** Why there is no Create action, in the order the server checks. */
  protected readonly reason = computed(() => {
    if (this.seeds().length < MIN_BRACKET_TEAMS) return BRACKET_MESSAGES.tooFewTeams;
    const tournament = this.tournament();
    if (registrationIsOpen(tournament, this.now())) {
      return BRACKET_MESSAGES.registrationOpen(tournament.registrationDeadline);
    }
    return this.hasResult() ? BRACKET_MESSAGES.resultEntered : null;
  });

  protected readonly rounds = computed(() => {
    const bracket = this.bracket();
    if (!bracket) return null;
    return bracket.rounds.map((round) => ({
      round: round.round,
      name: round.name,
      games: round.games.map((game) => ({
        gameId: game.gameId,
        slot: game.slot,
        label: game.teams
          .map((team) => team?.name ?? (round.round === 1 ? 'Bye' : 'To be decided'))
          .join(' v '),
      })),
    }));
  });

  protected isMoving(row: SeedRow, direction: SeedDirection): boolean {
    const moving = this.moving();
    return moving?.teamId === row.teamId && moving.direction === direction;
  }

  protected moveDisabled(row: SeedRow, direction: SeedDirection): boolean {
    const atEnd = direction === 'up' ? row.first : row.last;
    return atEnd || this.busy() || !this.online();
  }

  protected async move(row: SeedRow, direction: SeedDirection, event: Event): Promise<void> {
    if (this.busy() || (direction === 'up' ? row.first : row.last)) return;
    const button = event.currentTarget as HTMLElement;
    this.announcement.set('');
    this.notice.set(null);
    if (!this.online()) {
      this.show({ kind: 'offline', description: moveOfflineText(row.name) });
      return;
    }
    this.moving.set({ teamId: row.teamId, direction });
    try {
      const { seed, seedCount } = await this.moveSeed.run({
        tournamentId: this.tournament().tournamentId,
        teamId: row.teamId,
        direction,
      });
      this.announcement.set(movedText(row.name, direction, seed, seedCount));
      this.refocusUnlessMoved(button);
    } catch (error) {
      this.show(
        error instanceof ConvexOfflineError
          ? { kind: 'offline', description: moveOfflineText(row.name) }
          : {
              kind: 'failed',
              text: moveFailedText(row.name, bracketRefusalMessage(error)),
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
    if (this.hasBracket()) {
      this.dialogAlert.set(null);
      this.dialog().open();
      return;
    }
    if (!this.online()) {
      this.show({ kind: 'offline', description: createOfflineText(false) });
      return;
    }
    await this.send(false);
  }

  protected async recreate(): Promise<void> {
    if (this.creating()) return;
    this.dialogAlert.set(null);
    if (!this.online())
      return this.failInDialog({ kind: 'offline', description: createOfflineText(true) });
    if (!(await this.send(true))) return;
    this.dialog().close();
  }

  protected dialogClosed(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#create-bracket')?.focus(),
      { injector: this.injector },
    );
  }

  private async send(replace: boolean): Promise<boolean> {
    this.creating.set(true);
    try {
      const result = await this.createBracket.run({
        tournamentId: this.tournament().tournamentId,
        ...(replace && { replace }),
      });
      this.notice.set({
        kind: 'created',
        text: createdText(result.replaced, result.gameCount, roundCount(this.seeds().length)),
      });
      return true;
    } catch (error) {
      const offline = error instanceof ConvexOfflineError;
      const text = createFailedText(replace, bracketRefusalMessage(error));
      const description = createOfflineText(replace);
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
    if (notice.kind === 'created') return;
    afterNextRender(() => this.noticeAlert()?.focus(), { injector: this.injector });
  }

  /** Moving a row can drop focus from the pressed button; a reply that arrives after the user went elsewhere leaves focus there. */
  private refocusUnlessMoved(button: HTMLElement): void {
    afterNextRender(
      () => {
        const active = this.document.activeElement;
        if (active === null || active === this.document.body || active === button) button.focus();
      },
      { injector: this.injector },
    );
  }
}
