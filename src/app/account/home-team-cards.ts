import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCrown } from '@ng-icons/lucide';
import { HlmBadge } from '../ui/badge';
import { HlmCardImports } from '../ui/card';
import type { TeamForNextStep } from './next-step';
import { rosterProgress } from './roster-progress';
import { seasonRange } from './season-range';

export interface HomeTeam extends TeamForNextStep {
  seasonName: string;
  seasonEndDate: string;
}

// Keyed by string: a role this build does not know (one a later backend adds) gets no badge.
const ROLE_BADGES: Readonly<Record<string, { label: string; crown: boolean } | undefined>> = {
  captain: { label: 'Captain', crown: true },
  player: { label: 'Player', crown: false },
  guardian: { label: 'Guardian', crown: false },
};

@Component({
  selector: 'app-home-team-cards',
  imports: [HlmBadge, HlmCardImports, NgIcon, RouterLink],
  providers: [provideIcons({ lucideCheck, lucideCrown })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mt-8 md:mt-10' },
  template: `
    <section aria-labelledby="teams-heading">
      <h2 id="teams-heading" class="text-lg font-semibold tracking-tight">Your teams</h2>
      <ul role="list" class="mt-4 grid gap-4 md:grid-cols-2">
        @for (card of cards(); track card.teamId) {
          <li hlmCard>
            <div hlmCardHeader>
              <h3 hlmCardTitle class="min-w-0">
                <a
                  [routerLink]="card.path"
                  class="inline-flex items-center rounded-md wrap-anywhere text-lg font-semibold tracking-tight pointer-coarse:min-h-11 hover:underline"
                  >{{ card.teamName }}</a
                >
              </h3>
              <p hlmCardDescription class="min-w-0 wrap-anywhere">
                @if (card.tournamentName) {
                  {{ card.tournamentName }}
                } @else {
                  {{ card.leagueName }} &middot; {{ card.seasonName }}
                }
              </p>
              @if (card.badge; as badge) {
                <div hlmCardAction>
                  <span hlmBadge variant="secondary">
                    @if (badge.crown) {
                      <ng-icon name="lucideCrown" data-icon="inline-start" aria-hidden="true" />
                    }
                    {{ badge.label }}</span
                  >
                </div>
              }
            </div>
            <div hlmCardContent>
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-muted-foreground">
                    {{ card.tournamentName ? 'Tournament' : 'Season' }}
                  </dt>
                  <dd class="mt-0.5 font-medium">{{ card.dates }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">Roster</dt>
                  <dd class="mt-0.5 flex items-center gap-1.5 font-medium">
                    @if (card.progress.met) {
                      <ng-icon
                        name="lucideCheck"
                        class="text-base text-primary"
                        aria-hidden="true"
                      />
                    }
                    {{ card.progress.text }}
                  </dd>
                </div>
              </dl>
              <div aria-hidden="true" class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full bg-primary"
                  [style.width.%]="card.progress.percent"
                ></div>
              </div>
            </div>
          </li>
        }
      </ul>
    </section>
  `,
})
export class HomeTeamCards {
  readonly teams = input.required<readonly HomeTeam[]>();

  protected readonly cards = computed(() =>
    this.teams().map((team) => ({
      ...team,
      badge: ROLE_BADGES[team.role],
      // Segments, not a string, so the router encodes the id and it cannot change the path.
      path: ['/app', 'teams', team.teamId],
      dates: seasonRange(team.seasonStartDate, team.seasonEndDate),
      progress: rosterProgress(team.rosterCount, team.minimumRosterSize),
    })),
  );
}
