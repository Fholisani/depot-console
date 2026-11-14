import { Routes } from '@angular/router';
import { autoLoginPartialRoutesGuard } from 'angular-auth-oidc-client';

export const routes: Routes = [
  // Public pages (no sign-in).
  { path: '', loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage) },
  { path: 'signup', loadComponent: () => import('./pages/signup/signup.page').then((m) => m.SignupPage) },
  {
    path: 'verify-email',
    loadComponent: () => import('./pages/verify-email/verify-email.page').then((m) => m.VerifyEmailPage),
  },
  // Signed-in area, inside the shell.
  {
    path: 'app',
    canActivate: [autoLoginPartialRoutesGuard],
    loadComponent: () => import('./pages/shell/shell.page').then((m) => m.ShellPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'files',
        loadComponent: () => import('./pages/files/files.page').then((m) => m.FilesPage),
      },
      {
        path: 'files/:id',
        loadComponent: () => import('./pages/object/object.page').then((m) => m.ObjectPage),
      },
      {
        path: 'namespaces',
        loadComponent: () => import('./pages/namespaces/namespaces.page').then((m) => m.NamespacesPage),
      },
      {
        path: 'namespaces/:name',
        loadComponent: () =>
          import('./pages/namespace-detail/namespace-detail.page').then((m) => m.NamespaceDetailPage),
      },
      {
        path: 'keys',
        loadComponent: () => import('./pages/api-keys/api-keys.page').then((m) => m.ApiKeysPage),
      },
    ],
  },
  { path: 'dashboard', redirectTo: 'app/dashboard' },
  { path: '**', redirectTo: '' },
];
