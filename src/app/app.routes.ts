import { Routes } from '@angular/router';
import { autoLoginPartialRoutesGuard } from 'angular-auth-oidc-client';

export const routes: Routes = [
  // Public site (no sign-in), inside the shared header and footer.
  {
    path: '',
    loadComponent: () => import('./pages/public/public-layout').then((m) => m.PublicLayout),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage) },
      { path: 'pricing', loadComponent: () => import('./pages/pricing/pricing.page').then((m) => m.PricingPage) },
      { path: 'docs', loadComponent: () => import('./pages/docs/docs.page').then((m) => m.DocsPage) },
      { path: 'signup', loadComponent: () => import('./pages/signup/signup.page').then((m) => m.SignupPage) },
      { path: 's/:token', loadComponent: () => import('./pages/share/share.page').then((m) => m.SharePage) },
      {
        path: 'verify-email',
        loadComponent: () => import('./pages/verify-email/verify-email.page').then((m) => m.VerifyEmailPage),
      },
    ],
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
        path: 'albums',
        loadComponent: () => import('./pages/albums/albums.page').then((m) => m.AlbumsPage),
      },
      {
        path: 'albums/:id',
        loadComponent: () => import('./pages/albums/album.page').then((m) => m.AlbumPage),
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
