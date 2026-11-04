import { Routes } from '@angular/router';
import { captureInviteToken, captureTeamInviteToken } from './invites/capture-invite-token';

export const acceptInviteRoutes: Routes = [
  {
    // The link is `/invites/accept#<token>`; the guard moves the token into sessionStorage and redirects to the path alone, so no URL holds it.
    path: '',
    title: 'Staff invite | Omni League',
    canActivate: [captureInviteToken],
    // A link opened on the open page changes only the fragment, so the guard must run again.
    runGuardsAndResolvers: 'always',
    loadComponent: () => import('./invites/accept-invite-page').then((m) => m.AcceptInvitePage),
  },
];

export const joinTeamRoutes: Routes = [
  {
    // The team invite link `/teams/join#<token>`, captured into its own key as the staff link above is.
    path: '',
    title: 'Team invite | Omni League',
    canActivate: [captureTeamInviteToken],
    runGuardsAndResolvers: 'always',
    loadComponent: () => import('./teams/join-team-page').then((m) => m.JoinTeamPage),
  },
];
