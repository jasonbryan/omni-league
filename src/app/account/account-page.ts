import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../core/data/convex';
import { injectNow } from '../core/now';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { Shell } from '../shell';
import { greeting } from './greeting';
import { HomeFreeAgents } from './home-free-agents';
import { HomeNewUser } from './home-new-user';
import { HomeNextStep } from './home-next-step';
import { HomeNotifications } from './home-notifications';
import { HomeRunALeague } from './home-run-a-league';
import { HomeSkeleton } from './home-skeleton';
import { HomeTeamCards } from './home-team-cards';
import { nextStep } from './next-step';

const HOME_PATH = '/app';

@Component({
  selector: 'app-account-page',
  imports: [
    AdminAlert,
    HomeFreeAgents,
    HomeNewUser,
    HomeNextStep,
    HomeNotifications,
    HomeRunALeague,
    HomeSkeleton,
    HomeTeamCards,
    Shell,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
        <h1 class="text-2xl font-semibold tracking-tight wrap-anywhere md:text-3xl">
          {{ heading() }}
        </h1>
        <p class="mt-1 text-muted-foreground">{{ subtitle() }}</p>
        @switch (state()) {
          @case ('loading') {
            <app-home-skeleton />
          }
          @case ('failed') {
            <app-admin-alert
              class="mt-6 md:mt-8"
              kind="error"
              title="Your teams and registrations could not be loaded."
              description="Check your connection."
              ><a [href]="homePath">Try again</a></app-admin-alert
            >
            <app-home-notifications />
          }
          @case ('new') {
            <app-home-new-user [canRunLeague]="canRunLeague()" />
            <app-home-notifications />
          }
          @default {
            @if (step(); as step) {
              <app-home-next-step [step]="step" />
            }
            @if (teams().length > 0) {
              <app-home-team-cards [teams]="teams()" />
            }
            @if (freeAgents().length > 0) {
              <app-home-free-agents [registrations]="freeAgents()" [now]="now()" />
            }
            <app-home-notifications />
            @if (canRunLeague()) {
              <app-home-run-a-league />
            }
          }
        }
      </div>
    </app-shell>
  `,
})
export class AccountPage {
  private readonly auth = inject(AuthService);
  protected readonly now = injectNow();

  private readonly me = injectQuery(api.users.me, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );
  private readonly mine = injectQuery(api.teams.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );
  private readonly waiting = injectQuery(api.freeAgents.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );
  private readonly organizations = injectQuery(api.organizations.listMine, () =>
    this.auth.convexAuthenticated() ? {} : skipToken,
  );

  protected readonly homePath = HOME_PATH;
  protected readonly heading = computed(() => greeting(this.me.value()?.name));
  protected readonly teams = computed(() => this.mine.value() ?? []);
  protected readonly freeAgents = computed(() => this.waiting.value() ?? []);
  protected readonly step = computed(() => nextStep(this.teams(), this.now()));
  /** Unknown while the list loads or fails, so "Run a league?" is never offered to someone who may already run one. */
  protected readonly canRunLeague = computed(() => this.organizations.value()?.length === 0);

  protected readonly state = computed<'loading' | 'failed' | 'new' | 'ready'>(() => {
    if (this.mine.error() !== undefined || this.waiting.error() !== undefined) return 'failed';
    const organizationsPending =
      this.organizations.value() === undefined && this.organizations.error() === undefined;
    if (
      this.mine.value() === undefined ||
      this.waiting.value() === undefined ||
      organizationsPending
    ) {
      return 'loading';
    }
    return this.teams().length === 0 && this.freeAgents().length === 0 ? 'new' : 'ready';
  });
  protected readonly subtitle = computed(() =>
    this.state() === 'new'
      ? 'Your teams and registrations will show here.'
      : 'Your teams and registrations.',
  );
}
