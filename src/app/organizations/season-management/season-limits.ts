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
import { lucidePencil, lucideUsersRound } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { AdminAlert } from '../admin/admin-alert';
import type { AlertText } from '../admin/alert-text';
import { OUTLINE_BUTTON } from '../admin/button-classes';
import { MaxTeamsEditForm } from './max-teams-edit-form';
import { maxTeamsSavedText, maxTeamsSummary } from './max-teams-text';

const PANEL =
  'mt-6 overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';

@Component({
  selector: 'app-season-limits',
  imports: [AdminAlert, MaxTeamsEditForm, NgIcon],
  providers: [provideIcons({ lucidePencil, lucideUsersRound })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section aria-labelledby="limits-heading" [class]="panel">
      <div class="border-b border-border px-4 py-3 md:px-5">
        <h2 id="limits-heading" class="font-semibold">Limits</h2>
      </div>
      @if (savedText(); as saved) {
        <div class="border-b border-border px-4 py-3 md:px-5">
          <app-admin-alert
            #savedNotice
            kind="success"
            [title]="saved.title"
            [description]="saved.description"
          />
        </div>
      }
      <ul role="list" class="divide-y divide-border">
        @if (editing()) {
          <li class="px-4 py-4 md:px-5">
            <app-max-teams-edit-form
              [seasonId]="seasonId()"
              [maxTeams]="maxTeams()"
              [teamCount]="teamCount()"
              (cancelled)="closeEdit()"
              (saved)="savedLimit($event)"
            />
          </li>
        } @else {
          <li class="flex items-start gap-3 px-4 py-3.5 md:px-5">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
              ><ng-icon name="lucideUsersRound" class="text-lg" aria-hidden="true"
            /></span>
            <div class="min-w-0 flex-1">
              <h3 class="font-medium">Maximum teams</h3>
              <p class="mt-0.5 text-sm text-muted-foreground" data-testid="max-teams-summary">
                {{ summary() }}
              </p>
            </div>
            <button
              #editButton
              type="button"
              data-slot="button"
              [class]="outlineButton"
              (click)="openEdit()"
            >
              <ng-icon name="lucidePencil" data-icon="inline-start" aria-hidden="true" />Edit<span
                class="sr-only"
              >
                maximum teams</span
              >
            </button>
          </li>
        }
      </ul>
    </section>
  `,
})
export class SeasonLimits {
  private readonly injector = inject(Injector);

  readonly seasonId = input.required<Id<'seasons'>>();
  readonly maxTeams = input<number | undefined>(undefined);
  readonly teamCount = input.required<number>();

  protected readonly panel = PANEL;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly editing = signal(false);
  protected readonly savedText = signal<AlertText | null>(null);
  protected readonly summary = computed(() => maxTeamsSummary(this.maxTeams(), this.teamCount()));

  private readonly editButton = viewChild<ElementRef<HTMLButtonElement>>('editButton');
  private readonly savedNotice = viewChild<AdminAlert>('savedNotice');

  protected openEdit(): void {
    this.savedText.set(null);
    this.editing.set(true);
  }

  protected closeEdit(): void {
    this.editing.set(false);
    afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /** The form is gone, so focus moves to the status. */
  protected savedLimit(maxTeams: number | null): void {
    this.editing.set(false);
    this.savedText.set(maxTeamsSavedText(maxTeams));
    afterNextRender(() => this.savedNotice()?.focus(), { injector: this.injector });
  }
}
