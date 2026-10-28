import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Shell } from '../shell';
import { YourOrganizations } from './your-organizations';

@Component({
  selector: 'app-account-page',
  imports: [Shell, YourOrganizations],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <h1 class="text-2xl font-semibold tracking-tight">Home</h1>
        <app-your-organizations />
      </div>
    </app-shell>
  `,
})
export class AccountPage {}
