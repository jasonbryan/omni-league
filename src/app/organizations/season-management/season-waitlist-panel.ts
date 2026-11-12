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
  lucideCalendarDays,
  lucideCircleArrowUp,
  lucideListOrdered,
  lucideMail,
  lucideUserRound,
} from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from '../admin/admin-alert';
import { AdminOfflineAlert } from '../admin/admin-offline-alert';
import type { AlertText } from '../admin/alert-text';
import { OUTLINE_BUTTON } from '../admin/button-classes';
import { formatDay } from '../admin/format-day';
import { HlmSpinner } from '../../ui/spinner';
import type { SeasonWaitlist } from './season-context';
import {
  promotedText,
  promoteFailureOf,
  promoteFailureText,
  promoteOfflineText,
  waitlistNote,
} from './waitlist-text';
import { HlmCard } from '../../ui/card';

const PANEL = 'overflow-hidden';
const PANEL_HEAD =
  'flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5';
const PANEL_NOTE = 'border-b border-border px-4 py-3 md:px-5';
const LINE = 'flex items-start gap-1.5 text-sm text-muted-foreground';
const LINE_ICON = 'mt-0.5 shrink-0 text-base';
const EMAIL_LINK =
  'inline-flex items-center break-all underline underline-offset-4 hover:text-foreground pointer-coarse:min-h-11';

type Result =
  | { kind: 'promoted'; text: AlertText }
  | { kind: 'refused'; text: AlertText }
  | { kind: 'offline'; description: string };

type WaitlistEntryId = Id<'waitlistEntries'>;

const twoDigits = (n: number) => String(n).padStart(2, '0');

/** The viewer's own calendar day, as the visible date shows it. */
function localDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

/** Promote acts at once, with no confirmation: it only adds a team, and the result says what happened. */
@Component({
  selector: 'app-season-waitlist-panel',
  imports: [AdminAlert, AdminOfflineAlert, HlmCard, HlmSpinner, NgIcon],
  providers: [
    provideIcons({
      lucideCalendarDays,
      lucideCircleArrowUp,
      lucideListOrdered,
      lucideMail,
      lucideUserRound,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section hlmCard size="bare" id="waitlist" aria-labelledby="waitlist-heading" [class]="panel">
      <div [class]="panelHead">
        <h2 id="waitlist-heading" tabindex="-1" class="font-semibold focus:outline-none">
          Waitlist
        </h2>
        @if (waitlist(); as waitlist) {
          @if (waitlist.waitlistCount > 0) {
            <p class="text-sm text-muted-foreground tabular-nums" data-testid="waitlist-count">
              {{ waitlist.waitlistCount }} waiting
            </p>
          }
        }
      </div>
      @if (result(); as result) {
        <div [class]="panelNote">
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
      @if (waitlist(); as waitlist) {
        @if (rows().length > 0) {
          @if (note(); as note) {
            <div [class]="panelNote">
              <app-admin-alert kind="info" [title]="note.title" [description]="note.description" />
            </div>
          }
          <ol id="waitlist-list" role="list" class="divide-y divide-border">
            @for (row of rows(); track row.waitlistEntryId) {
              <li class="flex items-start gap-3 px-4 py-3.5 md:px-5">
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold tabular-nums"
                  ><span class="sr-only">Position </span>{{ row.position }}</span
                >
                <div class="min-w-0 flex-1">
                  <h3 class="font-medium">{{ row.teamName }}</h3>
                  <div class="mt-1 flex flex-col gap-1">
                    <p [class]="line">
                      <ng-icon name="lucideUserRound" [class]="lineIcon" aria-hidden="true" /><span
                        >Captain: {{ row.captainName }}</span
                      >
                    </p>
                    <p [class]="line">
                      <ng-icon name="lucideMail" [class]="lineIcon" aria-hidden="true" /><span
                        ><span class="sr-only">Email: </span
                        ><a [href]="row.mailto" [class]="emailLink">{{ row.captainEmail }}</a></span
                      >
                    </p>
                    <p [class]="line">
                      <ng-icon
                        name="lucideCalendarDays"
                        [class]="lineIcon"
                        aria-hidden="true"
                      /><span
                        >Joined <time [attr.datetime]="row.datetime">{{ row.joined }}</time></span
                      >
                    </p>
                  </div>
                  <div class="mt-3">
                    <button
                      type="button"
                      data-slot="button"
                      [attr.data-waitlist-entry-id]="row.waitlistEntryId"
                      [class]="outlineButton"
                      [class.opacity-50]="!online() && promoting() === null"
                      [attr.aria-disabled]="promoting() !== null || !online() ? 'true' : null"
                      (click)="promote(row)"
                    >
                      @if (promoting() === row.waitlistEntryId) {
                        <hlm-spinner data-icon="inline-start" />Promoting…<span class="sr-only">
                          {{ row.teamName }}</span
                        >
                      } @else {
                        <ng-icon
                          name="lucideCircleArrowUp"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />Promote<span class="sr-only"> {{ row.teamName }}</span>
                      }
                    </button>
                  </div>
                </div>
              </li>
            }
          </ol>
          @if (waitlist.waitlistCount > rows().length) {
            <p class="border-t border-border px-4 py-3 text-sm text-muted-foreground md:px-5">
              Showing the {{ rows().length }} who joined first. Promote some to see the rest.
            </p>
          }
        } @else {
          <div class="flex flex-col items-center px-6 py-10 text-center">
            <span
              class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              ><ng-icon name="lucideListOrdered" class="text-xl" aria-hidden="true"
            /></span>
            <p class="mt-4 font-medium">No teams waiting</p>
            <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
              When the season is full, teams that register wait here in the order they joined.
            </p>
          </div>
        }
      } @else {
        <div class="px-4 py-4 md:px-5">
          <app-admin-alert
            kind="error"
            title="The waitlist could not be loaded."
            description="Check your connection and try again."
          />
        </div>
      }
      <p role="status" class="sr-only">{{ promoting() ? 'Promoting the team.' : '' }}</p>
    </section>
  `,
})
export class SeasonWaitlistPanel {
  readonly waitlist = input.required<SeasonWaitlist | null>();
  readonly teamCount = input.required<number>();
  readonly maxTeams = input<number | undefined>(undefined);

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly promoteEntry = injectMutation(api.waitlist.promote);
  protected readonly online = injectOnline();

  protected readonly panel = PANEL;
  protected readonly panelHead = PANEL_HEAD;
  protected readonly panelNote = PANEL_NOTE;
  protected readonly line = LINE;
  protected readonly lineIcon = LINE_ICON;
  protected readonly emailLink = EMAIL_LINK;
  protected readonly outlineButton = OUTLINE_BUTTON;

  protected readonly promoting = signal<WaitlistEntryId | null>(null);
  protected readonly result = signal<Result | null>(null);
  private readonly resultAlert = viewChild<AdminAlert | AdminOfflineAlert>('resultAlert');

  protected readonly rows = computed(() =>
    (this.waitlist()?.rows ?? []).map((row, index) => ({
      ...row,
      position: index + 1,
      mailto: `mailto:${row.captainEmail}`,
      joined: formatDay(row.requestedAt),
      datetime: localDay(row.requestedAt),
    })),
  );

  protected readonly note = computed(() => waitlistNote(this.teamCount(), this.maxTeams()));

  protected async promote(row: {
    waitlistEntryId: WaitlistEntryId;
    teamName: string;
    captainName: string;
  }): Promise<void> {
    if (this.promoting() !== null) return;
    if (!this.online()) {
      this.show({ kind: 'offline', description: promoteOfflineText(row.teamName) });
      return;
    }
    this.result.set(null);
    this.promoting.set(row.waitlistEntryId);
    try {
      const { teamCount, maxTeams } = await this.promoteEntry.run({
        waitlistEntryId: row.waitlistEntryId,
      });
      this.show({
        kind: 'promoted',
        text: promotedText(row.teamName, row.captainName, teamCount, maxTeams),
      });
    } catch (error) {
      const failure = error instanceof ConvexOfflineError ? null : promoteFailureOf(error);
      this.show(
        failure === null
          ? { kind: 'offline', description: promoteOfflineText(row.teamName) }
          : { kind: 'refused', text: promoteFailureText(failure, row.teamName, row.captainName) },
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
        else this.host.nativeElement.querySelector<HTMLElement>('#waitlist-heading')?.focus();
      },
      { injector: this.injector },
    );
  }
}
