import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideLock } from '@ng-icons/lucide';
import { HlmCard } from '../../ui/card';
import { PRIMARY_BUTTON } from './button-classes';

@Component({
  selector: 'app-tournament-no-access',
  imports: [HlmCard, NgIcon, RouterLink],
  providers: [provideIcons({ lucideArrowLeft, lucideLock })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16' },
  template: `
    <div
      hlmCard
      size="bare"
      class="mx-auto flex max-w-lg flex-col items-center px-6 py-10 text-center md:py-12"
    >
      <span
        class="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"
      >
        <ng-icon name="lucideLock" class="text-2xl" aria-hidden="true" />
      </span>
      <h1 class="mt-6 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
        You can’t manage this tournament
      </h1>
      <p class="mt-3 text-balance text-muted-foreground">
        Only org admins and the league organizers assigned to it can open it. If you should have
        access, ask an org admin to assign it to you.
      </p>
      <a routerLink="/app" data-slot="button" [class]="primaryButton + ' mt-8'">
        <ng-icon name="lucideArrowLeft" data-icon="inline-start" aria-hidden="true" />
        Go to your organizations
      </a>
    </div>
  `,
})
export class TournamentNoAccess {
  protected readonly primaryButton = PRIMARY_BUTTON;

  constructor() {
    inject(Title).setTitle('No access | Omni League');
  }
}
