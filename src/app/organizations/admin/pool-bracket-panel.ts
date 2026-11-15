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
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideRefreshCw, lucideTrophy } from '@ng-icons/lucide';
import { BRACKET_MESSAGES, roundCount } from '../../../../convex/lib/bracket';
import { POOL_MESSAGES } from '../../../../convex/lib/pools';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import type { AlertText } from './alert-text';
import { BracketGame } from './bracket-game';
import {
  bracketRefusalMessage,
  createdText,
  createFailedText,
  createOfflineText,
  movedText,
  type SeedDirection,
} from './bracket-text';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { ChipRadioGroup } from './chip-radio-group';
import { ConfirmDialog, type ConfirmAlertView } from './confirm-dialog';
import {
  advanceDescription,
  advanceOptions,
  BRACKET_KEEPS_SEEDS_NOTE,
  placeText,
  SEEDS_HINT,
  SEEDS_NOT_SAVED_NOTE,
} from './pool-bracket-text';
import type { ManagedTournament, PoolBracketView } from './tournament-context';

const PANEL = 'overflow-hidden';
const PANEL_HEAD =
  'flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5';
const PANEL_NOTE = 'border-b border-border px-4 py-3 md:px-5';
const SECTION = 'border-t border-border px-4 py-4 md:px-5';
const HINT = 'text-sm text-muted-foreground';

const DEFAULT_ADVANCE = 2;

type Notice =
  | { kind: 'created'; text: AlertText }
  | { kind: 'failed'; text: AlertText }
  | { kind: 'offline'; description: string };

interface SeedRow {
  teamId: Id<'teams'>;
  name: string;
  seed: number;
  place: string;
  first: boolean;
  last: boolean;
}

function sameIds(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

@Component({
  selector: 'app-pool-bracket-panel',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    BracketGame,
    ChipRadioGroup,
    ConfirmDialog,
    HlmCard,
    HlmSkeleton,
    HlmSpinner,
    NgIcon,
  ],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideRefreshCw, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      hlmCard
      size="bare"
      id="pool-bracket"
      aria-labelledby="pool-bracket-heading"
      [class]="panel"
    >
      <div [class]="panelHead">
        <h2 id="pool-bracket-heading" tabindex="-1" class="font-semibold focus:outline-none">
          Bracket
        </h2>
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
          <p role="status" class="sr-only">Loading the bracket.</p>
        }
        @case ('error') {
          <div class="px-4 py-4 md:px-5">
            <app-admin-alert
              kind="error"
              title="The bracket could not be loaded."
              description="Check your connection and try again."
              ><a [href]="retryHref()" [class]="retryLink">Try again</a></app-admin-alert
            >
          </div>
        }
        @default {
          @if (waitingReason(); as waiting) {
            <p [class]="hint + ' px-4 py-4 md:px-5'" data-slot="create-reason">{{ waiting }}</p>
          } @else {
            @if (!hasResult()) {
              <div class="px-4 py-4 md:px-5">
                <app-chip-radio-group
                  name="advance-per-pool"
                  legend="Teams from each pool"
                  [options]="advanceChoices()"
                  [value]="'' + advance()"
                  [description]="advanceText()"
                  (chosen)="chooseAdvance($event)"
                />
              </div>
              @if (canMove()) {
                <p [class]="hint + ' border-t border-border px-4 pt-4 md:px-5'">
                  {{ seedsHint }} {{ notSavedNote }}
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
                id="pool-bracket-seeds"
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
                      <p [class]="hint" data-slot="place">{{ row.place }}</p>
                      @if (canMove()) {
                        <div class="mt-3 flex flex-wrap gap-2">
                          @for (direction of directions; track direction) {
                            <button
                              type="button"
                              data-slot="button"
                              [attr.data-move]="direction"
                              [class]="outlineButton"
                              [attr.aria-disabled]="moveDisabled(row, direction) ? 'true' : null"
                              (click)="move(row, direction, $event)"
                            >
                              <ng-icon
                                [name]="direction === 'up' ? 'lucideArrowUp' : 'lucideArrowDown'"
                                data-icon="inline-start"
                                aria-hidden="true"
                              />Move {{ direction }}<span class="sr-only"> {{ row.name }}</span>
                            </button>
                          }
                        </div>
                      }
                    </div>
                  </li>
                }
              </ol>
              @if (hasBracket() && canMove()) {
                <p
                  [class]="hint + ' border-t border-border px-4 py-3 md:px-5'"
                  data-slot="seed-note"
                >
                  {{ keepsSeedsNote }}
                </p>
              }
            }
            <div [class]="section">
              @if (hasResult()) {
                <p [class]="hint" data-slot="create-reason">{{ resultEntered }}</p>
              } @else {
                <button
                  type="button"
                  id="create-pool-bracket"
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
              <div id="pool-bracket-rounds" [class]="section">
                <h3 class="font-semibold">Games</h3>
                @if (winner(); as winner) {
                  <p data-slot="winner" class="mt-2 flex items-center gap-2 font-medium">
                    <ng-icon name="lucideTrophy" class="text-base" aria-hidden="true" />Winner:
                    {{ winner.name }}
                  </p>
                }
                @for (round of rounds; track round.round) {
                  <section
                    [attr.aria-labelledby]="'pool-bracket-round-' + round.round"
                    class="mt-4"
                  >
                    <h4
                      [id]="'pool-bracket-round-' + round.round"
                      class="text-sm font-medium text-muted-foreground"
                    >
                      {{ round.name }}
                    </h4>
                    <ol role="list" class="mt-2 flex flex-col gap-2">
                      @for (game of round.games; track game.gameId) {
                        <app-bracket-game
                          [game]="game"
                          [round]="round.round"
                          [tournament]="tournament()"
                        />
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
      cancelId="recreate-pool-bracket-cancel"
      heading="Recreate the bracket?"
      confirmLabel="Recreate bracket"
      pendingLabel="Recreating…"
      [pending]="creating()"
      [alert]="dialogAlert()"
      (confirmed)="recreate()"
      (closed)="dialogClosed()"
    >
      <p>The bracket is replaced using the seeds above. No bracket result has been entered.</p>
    </app-confirm-dialog>
  `,
})
export class PoolBracketPanel {
  readonly tournament = input.required<ManagedTournament>();
  readonly view = input.required<PoolBracketView>();
  readonly retryHref = input.required<string>();

  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly createCall = injectMutation(api.tournamentGames.createBracketFromPools);
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
  protected readonly seedsHint = SEEDS_HINT;
  protected readonly notSavedNote = SEEDS_NOT_SAVED_NOTE;
  protected readonly keepsSeedsNote = BRACKET_KEEPS_SEEDS_NOTE;
  protected readonly resultEntered = BRACKET_MESSAGES.resultEntered;
  protected readonly directions: readonly SeedDirection[] = ['up', 'down'];
  protected readonly skeletonRows = [1, 2, 3];

  protected readonly creating = signal(false);
  protected readonly announcement = signal('');
  protected readonly notice = signal<Notice | null>(null);
  protected readonly dialogAlert = signal<ConfirmAlertView | null>(null);
  private readonly chosenAdvance = signal<number | null>(null);

  private readonly noticeAlert = viewChild<AdminAlert | AdminOfflineAlert>('noticeAlert');
  private readonly dialog = viewChild.required(ConfirmDialog);

  readonly dialogOpen = computed(() => this.dialog().isOpen());

  private readonly setup = computed(() => {
    const view = this.view();
    return view.status === 'ready' ? view.setup : null;
  });
  private readonly bracket = computed(() => this.setup()?.bracket ?? null);
  protected readonly hasBracket = computed(() => this.bracket() !== null);
  protected readonly hasResult = computed(() => this.bracket()?.hasResult ?? false);
  protected readonly rounds = computed(() => this.bracket()?.rounds ?? null);
  protected readonly winner = computed(() => this.bracket()?.winner ?? null);

  /** Why there is no Create action yet, in the order the server checks. */
  protected readonly waitingReason = computed(() => {
    const setup = this.setup();
    if (!setup) return null;
    if (!setup.gamesCreated) return POOL_MESSAGES.noPoolGames;
    return setup.gamesWithoutResult > 0
      ? POOL_MESSAGES.poolGamesPending(setup.gamesWithoutResult)
      : null;
  });

  private readonly smallestPool = computed(() => this.setup()?.smallestPool ?? 0);
  protected readonly advanceChoices = computed(() => advanceOptions(this.smallestPool()));
  protected readonly advanceText = computed(() => advanceDescription(this.smallestPool()));
  protected readonly advance = computed(() => {
    const chosen = this.chosenAdvance();
    const smallest = this.smallestPool();
    return chosen !== null && chosen >= 1 && chosen <= smallest
      ? chosen
      : Math.min(DEFAULT_ADVANCE, smallest);
  });

  private readonly proposed = computed(
    () => {
      const setup = this.setup();
      return (setup?.ranked ?? []).slice(0, this.advance() * (setup?.poolCount ?? 0));
    },
    {
      equal: (a, b) =>
        sameIds(
          a.map((team) => team.teamId),
          b.map((team) => team.teamId),
        ),
    },
  );

  /** The advancing teams in the order the organizer set, which starts from the pool results and starts again when they change. */
  private readonly order = linkedSignal<readonly Id<'teams'>[]>(() =>
    this.proposed().map((team) => team.teamId),
  );

  protected readonly rows = computed<SeedRow[]>(() => {
    const byId = new Map(this.proposed().map((team) => [team.teamId, team]));
    const order = this.order().filter((teamId) => byId.has(teamId));
    return order.map((teamId, index) => {
      const team = byId.get(teamId)!;
      return {
        teamId,
        name: team.name,
        seed: index + 1,
        place: placeText(team.pool, team.place),
        first: index === 0,
        last: index === order.length - 1,
      };
    });
  });
  protected readonly canMove = computed(() => this.rows().length > 1 && !this.hasResult());

  protected chooseAdvance(key: string): void {
    this.chosenAdvance.set(Number(key));
    this.announcement.set('');
  }

  protected moveDisabled(row: SeedRow, direction: SeedDirection): boolean {
    return direction === 'up' ? row.first : row.last;
  }

  protected move(row: SeedRow, direction: SeedDirection, event: Event): void {
    if (this.moveDisabled(row, direction)) return;
    const button = event.currentTarget as HTMLElement;
    const order = [...this.order()];
    const index = order.indexOf(row.teamId);
    const target = direction === 'up' ? index - 1 : index + 1;
    [order[index], order[target]] = [order[target], order[index]];
    this.order.set(order);
    this.notice.set(null);
    this.announcement.set(movedText(row.name, direction, target + 1, order.length));
    this.refocusUnlessMoved(button);
  }

  protected async create(): Promise<void> {
    if (this.creating()) return;
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
      () => this.host.nativeElement.querySelector<HTMLElement>('#create-pool-bracket')?.focus(),
      { injector: this.injector },
    );
  }

  private async send(replace: boolean): Promise<boolean> {
    this.creating.set(true);
    try {
      const result = await this.createCall.run({
        tournamentId: this.tournament().tournamentId,
        advancePerPool: this.advance(),
        seedOrder: [...this.order()],
        ...(replace && { replace }),
      });
      this.notice.set({
        kind: 'created',
        text: createdText(result.replaced, result.gameCount, roundCount(result.teamCount)),
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

  /** Moving a row can drop focus from the pressed button, so it returns there unless the user went elsewhere. */
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
