import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClock } from '@ng-icons/lucide';
import { registrationIsOpen } from '../../../convex/lib/registration';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';
import { HlmBadge } from '../ui/badge';
import { HlmCardImports } from '../ui/card';

export interface HomeFreeAgent {
  freeAgentId: string;
  leagueName: string;
  seasonName: string;
  organizationName: string;
  registrationDeadline: string;
  seasonStartDate: string;
  seasonEndDate: string;
}

@Component({
  selector: 'app-home-free-agents',
  imports: [HlmBadge, HlmCardImports, NgIcon],
  providers: [provideIcons({ lucideClock })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mt-8 md:mt-10' },
  template: `
    <section aria-labelledby="free-agent-heading">
      <h2 id="free-agent-heading" class="text-lg font-semibold tracking-tight">Free agent</h2>
      <ul role="list" class="mt-4 flex flex-col gap-4">
        @for (card of cards(); track card.freeAgentId) {
          <li hlmCard>
            <div hlmCardContent class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div class="min-w-0 flex-1">
                <p class="text-base font-medium wrap-anywhere">
                  {{ card.leagueName }} &middot; {{ card.seasonName }}
                </p>
                <p class="mt-0.5 text-sm text-muted-foreground wrap-anywhere">{{ card.note }}</p>
              </div>
              <span hlmBadge variant="muted">
                <ng-icon name="lucideClock" data-icon="inline-start" aria-hidden="true" />
                Waiting</span
              >
            </div>
          </li>
        }
      </ul>
    </section>
  `,
})
export class HomeFreeAgents {
  readonly registrations = input.required<readonly HomeFreeAgent[]>();
  readonly now = input.required<number>();

  protected readonly cards = computed(() =>
    this.registrations().map((registration) => {
      const open = registrationIsOpen(
        {
          startDate: registration.seasonStartDate,
          registrationDeadline: registration.registrationDeadline,
        },
        this.now(),
      );
      const placement = open
        ? `An organizer places you on a team before ${formatCalendarDate(registration.registrationDeadline)}.`
        : 'An organizer places you on a team.';
      return { ...registration, note: `${registration.organizationName}. ${placement}` };
    }),
  );
}
