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
import { lucideCalendarDays, lucideCircleArrowUp, lucideMail } from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import { CAMP_WAITLIST_MESSAGES, type CampWaitlistCode } from '../../../../convex/lib/campWaitlist';
import {
  api,
  ConvexOfflineError,
  injectMutation,
  injectOfflineCause,
  injectOnline,
  injectQuery,
  offlineLead,
} from '../../core/data/convex';
import { HlmSkeleton } from '../../ui/skeleton';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import type { AlertText } from './alert-text';
import { OUTLINE_BUTTON } from './button-classes';
import { formatDay } from './format-day';

export const NO_ONE_WAITING = 'No one is waiting.';

const SKELETON_ROWS = [1, 2];

const LINE = 'flex items-start gap-1.5 text-sm text-muted-foreground';
const LINE_ICON = 'mt-0.5 shrink-0 text-base';

type Result =
  | { kind: 'promoted'; text: AlertText }
  | { kind: 'refused'; text: AlertText }
  | { kind: 'offline'; description: string };

type EntryId = Id<'campWaitlistEntries'>;

const REFUSAL_CODES: readonly CampWaitlistCode[] = ['noFreePlace', 'notWaiting', 'notNext'];

/** Only the message of a refusal the server words for the organizer is shown: any other failure's message is server detail. */
function refusalMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null) return null;
  const { code, message } = data as { code?: unknown; message?: unknown };
  return REFUSAL_CODES.includes(code as CampWaitlistCode) && typeof message === 'string'
    ? message
    : null;
}

/** Promote acts at once, with no confirmation: it only gives the person the place they waited for, and the result says what happened. */
@Component({
  selector: 'app-camp-waitlist',
  imports: [AdminAlert, AdminOfflineAlert, HlmSkeleton, HlmSpinner, NgIcon],
  providers: [provideIcons({ lucideCalendarDays, lucideCircleArrowUp, lucideMail })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <h4 tabindex="-1" class="mb-2 text-sm font-semibold focus:outline-none">Waitlist</h4>
    @if (result(); as result) {
      <div class="mb-3">
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
    @if (failed()) {
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
    } @else if (rows(); as rows) {
      @if (rows.length > 0) {
        @if (!hasFreePlace()) {
          <p data-slot="waitlist-note" class="mb-2 text-sm text-muted-foreground">
            {{ noFreePlace }}
          </p>
        }
        <ol role="list" class="divide-y divide-border">
          @for (row of rows; track row.campWaitlistEntryId; let first = $first) {
            <li class="flex items-start gap-3 py-3">
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold tabular-nums"
                ><span class="sr-only">Position </span>{{ $index + 1 }}</span
              >
              <div class="min-w-0 flex-1">
                <p class="font-medium wrap-anywhere">{{ row.name }}</p>
                <div class="mt-1 flex flex-col gap-1">
                  @if (row.guardian; as guardian) {
                    <p data-slot="waitlist-guardian" [class]="line">
                      <ng-icon name="lucideMail" [class]="lineIcon" aria-hidden="true" /><span
                        class="wrap-anywhere"
                        >Guardian: {{ guardianLine(guardian) }}</span
                      >
                    </p>
                  }
                  <p [class]="line">
                    <ng-icon name="lucideCalendarDays" [class]="lineIcon" aria-hidden="true" /><span
                      >Joined {{ day(row.requestedAt) }}</span
                    >
                  </p>
                </div>
                @if (first && hasFreePlace()) {
                  <div class="mt-3">
                    <button
                      type="button"
                      data-slot="button"
                      [class]="outlineButton"
                      [class.opacity-50]="!online() && promoting() === null"
                      [attr.aria-disabled]="promoting() !== null || !online() ? 'true' : null"
                      (click)="promote(row)"
                    >
                      @if (promoting() === row.campWaitlistEntryId) {
                        <hlm-spinner data-icon="inline-start" />Promoting…<span class="sr-only">
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
                  </div>
                }
              </div>
            </li>
          }
        </ol>
      } @else {
        <p data-slot="waitlist-empty" class="py-2 text-muted-foreground">{{ noOneWaiting }}</p>
      }
    } @else if (!online()) {
      <p role="status" data-slot="waitlist-offline" class="py-2 text-muted-foreground">
        {{ offlineText() }}
      </p>
    } @else {
      <p role="status" class="sr-only">Loading the waitlist.</p>
      <div aria-hidden="true" class="divide-y divide-border">
        @for (row of skeletonRows; track row) {
          <div class="py-3">
            <div hlmSkeleton class="h-4 w-40 max-w-full rounded-md"></div>
            <div hlmSkeleton class="mt-2 h-3.5 w-56 max-w-full rounded-md"></div>
          </div>
        }
      </div>
    }
    <p role="status" class="sr-only">{{ promoting() ? 'Giving the place.' : '' }}</p>
  `,
})
export class CampWaitlist {
  readonly sessionId = input.required<Id<'campSessions'>>();
  readonly sessionName = input.required<string>();
  readonly freePlaces = input.required<number>();
  readonly retryHref = input.required<string>();

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cause = injectOfflineCause();
  private readonly list = injectQuery(api.campWaitlist.listForSession, () => ({
    sessionId: this.sessionId(),
  }));
  private readonly promoteEntry = injectMutation(api.campWaitlist.promote);

  protected readonly online = injectOnline();
  protected readonly line = LINE;
  protected readonly lineIcon = LINE_ICON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly day = formatDay;
  protected readonly noOneWaiting = NO_ONE_WAITING;
  protected readonly noFreePlace = CAMP_WAITLIST_MESSAGES.noFreePlace;
  protected readonly rows = this.list.value;
  protected readonly failed = computed(() => this.list.error() !== undefined);
  protected readonly hasFreePlace = computed(() => this.freePlaces() > 0);
  protected readonly offlineText = computed(
    () => `${offlineLead(this.cause())} The waitlist will load when you’re connected.`,
  );

  protected readonly promoting = signal<EntryId | null>(null);
  protected readonly result = signal<Result | null>(null);
  private readonly resultAlert = viewChild<AdminAlert | AdminOfflineAlert>('resultAlert');

  protected guardianLine(guardian: { name: string; email: string }): string {
    return guardian.email === '' ? guardian.name : `${guardian.name}, ${guardian.email}`;
  }

  protected async promote(row: { campWaitlistEntryId: EntryId; name: string }): Promise<void> {
    if (this.promoting() !== null) return;
    if (!this.online()) {
      this.show({
        kind: 'offline',
        description: `${row.name} is still waiting. Try again when you’re connected.`,
      });
      return;
    }
    this.result.set(null);
    this.promoting.set(row.campWaitlistEntryId);
    try {
      await this.promoteEntry.run({ campWaitlistEntryId: row.campWaitlistEntryId });
      this.show({
        kind: 'promoted',
        text: {
          title: `${row.name} has a place.`,
          description: `Registered for ${this.sessionName()}.`,
        },
      });
    } catch (error) {
      this.show(
        error instanceof ConvexOfflineError
          ? {
              kind: 'offline',
              description: `${row.name} is still waiting. Try again when you’re connected.`,
            }
          : {
              kind: 'refused',
              text: {
                title: `${row.name} could not be given a place.`,
                description: refusalMessage(error) ?? 'Check your connection and try again.',
              },
            },
      );
    } finally {
      this.promoting.set(null);
    }
  }

  /** The result takes focus: after a promotion the row and its button are gone. */
  private show(result: Result): void {
    this.result.set(result);
    afterNextRender(
      () => {
        const alert = this.resultAlert();
        if (alert) alert.focus();
        else this.host.nativeElement.querySelector<HTMLElement>('h4')?.focus();
      },
      { injector: this.injector },
    );
  }
}
