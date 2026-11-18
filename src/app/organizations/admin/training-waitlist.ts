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
import { lucideCircleArrowUp } from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  TRAINING_WAITLIST_MESSAGES,
  type TrainingWaitlistCode,
} from '../../../../convex/lib/trainingWaitlist';
import {
  api,
  ConvexOfflineError,
  injectMutation,
  injectOfflineCause,
  injectOnline,
  injectQuery,
  offlineLead,
} from '../../core/data/convex';
import { HlmBadge } from '../../ui/badge';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { HlmSpinner } from '../../ui/spinner';
import { HlmTableImports } from '../../ui/table';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import type { AlertText } from './alert-text';
import { OUTLINE_BUTTON } from './button-classes';
import { formatDay } from './format-day';

export const NO_ONE_WAITING_FOR_SERIES = 'No one is waiting.';

type Result =
  | { kind: 'promoted'; text: AlertText }
  | { kind: 'refused'; text: AlertText }
  | { kind: 'offline'; description: string };

type EntryId = Id<'trainingWaitlistEntries'>;

const REFUSAL_CODES: readonly TrainingWaitlistCode[] = [
  'noFreePlace',
  'notWaiting',
  'notNext',
  'noUpcomingClass',
];

/** Only the message of a refusal the server words for the organizer is shown: any other failure's message is server detail. */
function refusalMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null) return null;
  const { code, message } = data as { code?: unknown; message?: unknown };
  return REFUSAL_CODES.includes(code as TrainingWaitlistCode) && typeof message === 'string'
    ? message
    : null;
}

/**
 * Promote acts at once, with no confirmation: it only gives the person the places they waited for, and the result says what happened.
 * The first row always carries Promote, dimmed while no place is free, so every row keeps its height as the list answers.
 */
@Component({
  selector: 'app-training-waitlist',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    HlmBadge,
    HlmCard,
    HlmSkeleton,
    HlmSpinner,
    HlmTableImports,
    NgIcon,
  ],
  providers: [provideIcons({ lucideCircleArrowUp })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      id="waitlist"
      aria-labelledby="waitlist-heading"
      hlmCard
      size="bare"
      class="mt-4 max-w-2xl overflow-hidden md:mt-6"
    >
      <div
        class="flex min-h-13 items-center justify-between gap-x-3 border-b border-border px-4 py-3 md:px-5"
      >
        <h2 id="waitlist-heading" tabindex="-1" class="font-semibold focus:outline-none">
          Waitlist
        </h2>
        @if (waitingCount() > 0) {
          <p data-slot="waitlist-count" class="text-sm text-muted-foreground tabular-nums">
            {{ waitingCount() }} waiting
          </p>
        }
      </div>
      @if (result(); as result) {
        <div class="border-b border-border px-4 py-3 md:px-5">
          @if (result.kind === 'offline') {
            <app-admin-offline-alert #resultAlert [description]="result.description" />
          } @else {
            <app-admin-alert
              #resultAlert
              [kind]="result.kind === 'promoted' ? 'success' : 'error'"
              [title]="result.text.title"
              [description]="result.text.description"
            />
          }
        </div>
      }
      <div class="px-4 md:px-5">
        @if (failed()) {
          <div class="py-4">
            <app-admin-alert
              kind="error"
              title="The waitlist could not be loaded."
              description="Check your connection and try again."
              ><a
                [href]="retryHref()"
                class="font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                >Try again</a
              ></app-admin-alert
            >
          </div>
        } @else if (rows(); as rows) {
          @if (rows.length > 0) {
            <div hlmTableContainer [attr.aria-label]="'Waitlist of ' + trainingName()">
              <table hlmTable>
                <caption hlmCaption class="sr-only">
                  Waitlist of
                  {{
                    trainingName()
                  }}
                </caption>
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh scope="col" class="text-start whitespace-nowrap">Position</th>
                    <th hlmTh scope="col" class="text-start">Name</th>
                    <th hlmTh scope="col" class="text-start whitespace-nowrap">Waiting for</th>
                    <th hlmTh scope="col" class="text-end whitespace-nowrap">Joined</th>
                    <th hlmTh scope="col" class="sticky end-0 bg-card text-end">
                      <span class="sr-only">Promote</span>
                    </th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (row of rows; track row.trainingWaitlistEntryId; let index = $index) {
                    <tr hlmTr data-slot="waiting">
                      <td hlmTd class="tabular-nums">{{ index + 1 }}</td>
                      <th hlmTh scope="row" class="text-start whitespace-nowrap">
                        {{ row.name }}
                        @if (row.guardian; as guardian) {
                          <span
                            data-slot="waiting-guardian"
                            class="block text-xs font-normal text-muted-foreground"
                            >Guardian: {{ guardianLine(guardian) }}</span
                          >
                        }
                      </th>
                      <td hlmTd>
                        <span hlmBadge variant="secondary" data-slot="waiting-kind">Series</span>
                      </td>
                      <td hlmTd class="text-end whitespace-nowrap">{{ day(row.requestedAt) }}</td>
                      <td hlmTd class="sticky end-0 bg-card text-end">
                        @if (index === 0) {
                          <button
                            type="button"
                            data-slot="button"
                            [class]="outlineButton"
                            [class.opacity-50]="
                              !row.canPromote || (!online() && promoting() === null)
                            "
                            [attr.aria-disabled]="
                              !row.canPromote || promoting() !== null || !online() ? 'true' : null
                            "
                            [attr.aria-describedby]="row.canPromote ? null : 'promote-hint'"
                            (click)="promote(row)"
                          >
                            @if (promoting() === row.trainingWaitlistEntryId) {
                              <hlm-spinner data-icon="inline-start" />Promoting…<span
                                class="sr-only"
                              >
                                {{ row.name }}</span
                              >
                            } @else {
                              <ng-icon
                                name="lucideCircleArrowUp"
                                data-icon="inline-start"
                                aria-hidden="true"
                              />Promote<span class="sr-only"> {{ row.name }}</span>
                            }
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p id="promote-hint" class="sr-only">{{ noFreePlace }}</p>
          } @else {
            <p data-slot="waitlist-empty" class="py-2 text-muted-foreground">
              {{ noOneWaiting }}
            </p>
          }
        } @else if (!online()) {
          <p role="status" data-slot="waitlist-offline" class="py-2 text-muted-foreground">
            {{ offlineText() }}
          </p>
        } @else {
          <p role="status" class="sr-only">Loading the waitlist.</p>
          @if (waitingCount() === 0) {
            <div aria-hidden="true" class="py-2">
              <div hlmSkeleton class="h-lh w-56 max-w-full rounded-md"></div>
            </div>
          } @else {
            <div aria-hidden="true">
              <table hlmTable>
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh scope="col" class="text-start whitespace-nowrap">Position</th>
                    <th hlmTh scope="col" class="text-start">Name</th>
                    <th hlmTh scope="col" class="text-start whitespace-nowrap">Waiting for</th>
                    <th hlmTh scope="col" class="text-end whitespace-nowrap">Joined</th>
                    <th hlmTh scope="col" class="text-end"></th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (row of skeletonRows(); track row) {
                    <tr hlmTr>
                      <td hlmTd><div hlmSkeleton class="h-4 w-4 rounded-md"></div></td>
                      <th hlmTh scope="row">
                        <div hlmSkeleton class="h-4 w-full max-w-40 rounded-md"></div>
                      </th>
                      <td hlmTd><div hlmSkeleton class="h-4 w-14 rounded-md"></div></td>
                      <td hlmTd class="text-end">
                        <div hlmSkeleton class="ms-auto h-4 w-20 rounded-md"></div>
                      </td>
                      <td hlmTd class="text-end">
                        @if (row === 0) {
                          <div
                            hlmSkeleton
                            class="ms-auto h-9 w-24 rounded-lg pointer-coarse:h-11"
                          ></div>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      </div>
      <p role="status" class="sr-only">{{ promoting() ? 'Giving the places.' : '' }}</p>
    </section>
  `,
})
export class TrainingWaitlist {
  readonly trainingId = input.required<Id<'trainings'>>();
  readonly trainingName = input.required<string>();
  readonly retryHref = input.required<string>();
  /** The entries that wait, known before the list answers, so its skeleton takes the room of the rows. */
  readonly waitlistCount = input.required<number>();

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cause = injectOfflineCause();
  private readonly list = injectQuery(api.trainingWaitlist.listForTraining, () => ({
    trainingId: this.trainingId(),
  }));
  private readonly promoteEntry = injectMutation(api.trainingWaitlist.promote);

  protected readonly online = injectOnline();
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly day = formatDay;
  protected readonly noOneWaiting = NO_ONE_WAITING_FOR_SERIES;
  protected readonly noFreePlace = TRAINING_WAITLIST_MESSAGES.noFreePlace;
  protected readonly rows = this.list.value;
  protected readonly failed = computed(() => this.list.error() !== undefined);
  protected readonly waitingCount = computed(() => this.rows()?.length ?? this.waitlistCount());
  protected readonly skeletonRows = computed(() =>
    Array.from({ length: this.waitlistCount() }, (_, index) => index),
  );
  protected readonly offlineText = computed(
    () => `${offlineLead(this.cause())} The waitlist will load when you’re connected.`,
  );

  protected readonly promoting = signal<EntryId | null>(null);
  protected readonly result = signal<Result | null>(null);
  private readonly resultAlert = viewChild<AdminAlert | AdminOfflineAlert>('resultAlert');

  protected guardianLine(guardian: { name: string; email: string }): string {
    return guardian.email === '' ? guardian.name : `${guardian.name}, ${guardian.email}`;
  }

  protected async promote(row: {
    trainingWaitlistEntryId: EntryId;
    name: string;
    canPromote: boolean;
  }): Promise<void> {
    if (this.promoting() !== null) return;
    if (!this.online()) {
      this.show({
        kind: 'offline',
        description: `${row.name} is still waiting. Try again when you’re connected.`,
      });
      return;
    }
    if (!row.canPromote) {
      this.show(this.refused(row.name, this.noFreePlace));
      return;
    }
    this.result.set(null);
    this.promoting.set(row.trainingWaitlistEntryId);
    try {
      await this.promoteEntry.run({ trainingWaitlistEntryId: row.trainingWaitlistEntryId });
      this.show({
        kind: 'promoted',
        text: {
          title: `${row.name} has a place.`,
          description: `Registered for every class of ${this.trainingName()}.`,
        },
      });
    } catch (error) {
      this.show(
        error instanceof ConvexOfflineError
          ? {
              kind: 'offline',
              description: `${row.name} is still waiting. Try again when you’re connected.`,
            }
          : this.refused(row.name, refusalMessage(error) ?? 'Check your connection and try again.'),
      );
    } finally {
      this.promoting.set(null);
    }
  }

  private refused(name: string, description: string): Result {
    return { kind: 'refused', text: { title: `${name} could not be given a place.`, description } };
  }

  /** The result takes focus: after a promotion the row and its button are gone. */
  private show(result: Result): void {
    this.result.set(result);
    afterNextRender(
      () => {
        const alert = this.resultAlert();
        if (alert) alert.focus();
        else this.host.nativeElement.querySelector<HTMLElement>('h2')?.focus();
      },
      { injector: this.injector },
    );
  }
}
