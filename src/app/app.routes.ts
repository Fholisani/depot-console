import { Routes } from '@angular/router';
import { autoLoginPartialRoutesGuard } from 'angular-auth-oidc-client';

export const routes: Routes = [
  // Public pages (no sign-in).
  { path: '', loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage) },
  // Signed-in area.
  {
    path: 'dashboard',
    canActivate: [autoLoginPartialRoutesGuard],
    loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  { path: '**', redirectTo: '' },
];
