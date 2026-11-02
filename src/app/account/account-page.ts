import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBell } from '@ng-icons/lucide';
import { Shell } from '../shell';
import { OUTLINE_BUTTON } from '../ui/button/button-classes';
import { YourOrganizations } from './your-organizations';

@Component({
  selector: 'app-account-page',
  imports: [NgIcon, RouterLink, Shell, YourOrganizations],
  providers: [provideIcons({ lucideBell })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <h1 class="text-2xl font-semibold tracking-tight">Home</h1>
        <app-your-organizations />
        <section
          aria-labelledby="app-notifications-heading"
          class="mt-4 max-w-xl px-4 py-4 md:px-5 md:py-5 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
        >
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex min-w-0 items-start gap-3">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                ><ng-icon name="lucideBell" class="text-lg" aria-hidden="true"
              /></span>
              <div class="min-w-0">
                <h2 id="app-notifications-heading" class="font-semibold">Notifications</h2>
                <p class="text-sm text-muted-foreground">
                  Game reminders, schedule changes, and score updates.
                </p>
              </div>
            </div>
            <a data-slot="button" routerLink="/app/notifications" [class]="outlineButton"
              >Manage<span class="sr-only"> notifications</span></a
            >
          </div>
        </section>
      </div>
    </app-shell>
  `,
})
export class AccountPage {
  protected readonly outlineButton = OUTLINE_BUTTON;
}
