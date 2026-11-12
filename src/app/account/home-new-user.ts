import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideSearch, lucideTrophy } from '@ng-icons/lucide';
import { HlmCardImports } from '../ui/card';
import { OUTLINE_BUTTON_LARGE, PRIMARY_BUTTON_LARGE } from '../ui/button/button-classes';

const ICON_TILE =
  'flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground';

@Component({
  selector: 'app-home-new-user',
  imports: [HlmCardImports, NgIcon, RouterLink],
  providers: [provideIcons({ lucidePlus, lucideSearch, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-6 grid gap-4 md:mt-8 md:grid-cols-2' },
  template: `
    <section hlmCard size="lg" aria-labelledby="start-heading">
      <div hlmCardContent class="flex flex-col">
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
      </div>
    </section>
    @if (canRunLeague()) {
      <section hlmCard size="lg" aria-labelledby="run-heading">
        <div hlmCardContent class="flex flex-col">
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
        </div>
      </section>
    }
  `,
})
export class HomeNewUser {
  readonly canRunLeague = input.required<boolean>();

  protected readonly iconTile = ICON_TILE;
  protected readonly findButton = `mt-5 w-full sm:w-fit ${PRIMARY_BUTTON_LARGE}`;
  protected readonly createButton = `mt-5 w-full sm:w-fit ${OUTLINE_BUTTON_LARGE}`;
}
