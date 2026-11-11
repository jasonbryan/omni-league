import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home-run-a-league',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-10 block text-sm text-muted-foreground' },
  template: `
    <p>
      Run a league?
      <a
        routerLink="/app/organizations/new"
        class="font-medium text-foreground underline underline-offset-4"
        >Create an organization</a
      >
    </p>
  `,
})
export class HomeRunALeague {}
