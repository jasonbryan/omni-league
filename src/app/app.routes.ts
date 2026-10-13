import { Routes } from '@angular/router';
import { redirectSignedIn, requireSignedIn } from './core/auth/guards';
import { captureInviteToken } from './invites/capture-invite-token';

export const routes: Routes = [
  {
    path: '',
    // The not-found view sets its own title, so a navigation home sets this one back.
    title: 'Omni League',
    loadComponent: () => import('./placeholder/placeholder').then((m) => m.Placeholder),
  },
  {
    // The public organization page (#60), a Server route (app.routes.server.ts).
    path: 'organizations/:orgSlug',
    loadComponent: () =>
      import('./organizations/organization-page').then((m) => m.OrganizationPage),
  },
  {
    // The sport view (#114), a Server route (app.routes.server.ts): one sport's published leagues,
    // `?page=N` for the numbered control. Ahead of nothing it could shadow: its path has a
    // literal `sports` segment.
    path: 'organizations/:orgSlug/sports/:sport',
    loadComponent: () =>
      import('./organizations/sport-view/sport-view-page').then((m) => m.SportViewPage),
  },
  {
    // The public league page (#127), a Server route (app.routes.server.ts): the league's published
    // seasons, `?page=N` for the numbered control.
    path: 'organizations/:orgSlug/leagues/:leagueSlug',
    loadComponent: () =>
      import('./organizations/public-league/public-league-page').then((m) => m.PublicLeaguePage),
  },
  {
    // The public season page (#128), a Server route (app.routes.server.ts): the season's dates,
    // format, and minimum roster size.
    path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    loadComponent: () =>
      import('./organizations/public-season/public-season-page').then((m) => m.PublicSeasonPage),
  },
  {
    // Sign-up (#62), a Client route. A signed-in visitor goes on to `returnTo`, else /app.
    path: 'sign-up',
    title: 'Create an account | Omni League',
    canActivate: [redirectSignedIn],
    loadComponent: () => import('./sign-up/sign-up-page').then((m) => m.SignUpPage),
  },
  {
    // Sign-in (#63), a Client route. A signed-in visitor goes on to `returnTo`, else /app.
    path: 'sign-in',
    title: 'Sign in | Omni League',
    canActivate: [redirectSignedIn],
    loadComponent: () => import('./sign-in/sign-in-page').then((m) => m.SignInPage),
  },
  {
    // Accepting a staff invite (#70), a Client route. The link is `/invites/accept#<token>`; the
    // guard moves the token into sessionStorage and redirects to the path alone, so no URL holds it.
    // Open to a signed-out visitor, who signs up or in and comes back here.
    path: 'invites/accept',
    title: 'Staff invite | Omni League',
    canActivate: [captureInviteToken],
    // A link opened on the open page changes only the fragment, so the guard must run again.
    runGuardsAndResolvers: 'always',
    loadComponent: () => import('./invites/accept-invite-page').then((m) => m.AcceptInvitePage),
  },
  {
    // The signed-in app (#62): Client routes only (app.routes.server.ts), so the guards never run
    // on the server. Unknown /app paths get the not-found view in the client shell.
    path: 'app',
    children: [
      {
        path: '',
        title: 'Your account | Omni League',
        canActivate: [requireSignedIn],
        loadComponent: () => import('./account/account-page').then((m) => m.AccountPage),
      },
      {
        // Create an organization (#64). Ahead of the admin area's `organizations/:slug` (#65), and
        // the reserved slug `new` keeps the two apart.
        path: 'organizations/new',
        title: 'Create an organization | Omni League',
        canActivate: [requireSignedIn],
        loadComponent: () =>
          import('./organizations/create-organization-page').then((m) => m.CreateOrganizationPage),
      },
      {
        // The league management page (#125): org admins and the league's assigned league
        // organizers. Ahead of the admin area, whose `organizations/:slug` is a shorter prefix of
        // the same URL space. It asks leagues.getOrganizerContext first and renders the page only
        // for someone who may organize the league.
        path: 'organizations/:orgSlug/leagues/:leagueSlug',
        canActivate: [requireSignedIn],
        loadComponent: () => import('./organizations/league/league-page').then((m) => m.LeaguePage),
      },
      {
        // The organization admin area (#65). The parent asks organizations.getAdminContext first
        // and renders a child only for an org admin; the no-access and not-found views take the
        // place of every child. Overview is the area's own path.
        path: 'organizations/:slug',
        canActivate: [requireSignedIn],
        loadComponent: () => import('./organizations/admin/admin-area').then((m) => m.AdminArea),
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./organizations/admin/admin-overview').then((m) => m.AdminOverview),
          },
          {
            path: 'locations',
            loadComponent: () =>
              import('./organizations/admin/admin-locations').then((m) => m.AdminLocations),
          },
          {
            path: 'leagues',
            loadComponent: () =>
              import('./organizations/admin/admin-leagues').then((m) => m.AdminLeagues),
          },
          {
            path: 'staff',
            loadComponent: () =>
              import('./organizations/admin/admin-staff').then((m) => m.AdminStaff),
          },
        ],
      },
      {
        path: '**',
        loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
      },
    ],
  },
  // Last: every URL no other route matches. The `**` server route renders it with status 404.
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
