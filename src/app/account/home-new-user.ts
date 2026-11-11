import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideSearch, lucideTrophy } from '@ng-icons/lucide';
import { OUTLINE_BUTTON_LARGE, PRIMARY_BUTTON_LARGE } from '../ui/button/button-classes';

const CARD =
  'flex flex-col p-6 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';
const ICON_TILE =
  'flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground';

@Component({
  selector: 'app-home-new-user',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucidePlus, lucideSearch, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-6 grid gap-4 md:mt-8 md:grid-cols-2' },
  template: `
    <section aria-labelledby="start-heading" [class]="card">
      <span [class]="iconTile"
        ><ng-icon name="lucideSearch" class="text-xl" aria-hidden="true"
      /></span>
      <h2 id="start-heading" class="mt-4 text-lg font-semibold tracking-tight">
        You&apos;re not on a team yet
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Find a league, then register a team or register as a free agent. Got an invite link from a
        captain? Open it to join their team.
      </p>
      <a routerLink="/leagues" data-slot="button" [class]="findButton">Find a league</a>
    </section>
    @if (canRunLeague()) {
      <section aria-labelledby="run-heading" [class]="card">
        <span [class]="iconTile"
          ><ng-icon name="lucideTrophy" class="text-xl" aria-hidden="true"
        /></span>
        <h2 id="run-heading" class="mt-4 text-lg font-semibold tracking-tight">Run a league?</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Create an organization to publish your leagues and take registrations.
        </p>
        <a routerLink="/app/organizations/new" data-slot="button" [class]="createButton"
          >Create an organization</a
        >
      </section>
    }
  `,
})
export class HomeNewUser {
  readonly canRunLeague = input.required<boolean>();

  protected readonly card = CARD;
  protected readonly iconTile = ICON_TILE;
  protected readonly findButton = `mt-5 w-full sm:w-fit ${PRIMARY_BUTTON_LARGE}`;
  protected readonly createButton = `mt-5 w-full sm:w-fit ${OUTLINE_BUTTON_LARGE}`;
}
