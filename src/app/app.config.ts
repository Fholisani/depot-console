import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { LogLevel, provideAuth } from 'angular-auth-oidc-client';
import { routes } from './app.routes';
import { APP_CONFIG, AppConfig } from './core/config/app-config';
import { depotInterceptor } from './core/http/depot.interceptor';

/** Providers for the app, built from the runtime config loaded in `main.ts`. */
export function appConfig(config: AppConfig): ApplicationConfig {
  // Where Keycloak sends the user back: the Console's own base URL (works locally and per slot).
  const home = new URL(document.baseURI).toString();
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      { provide: APP_CONFIG, useValue: config },
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(withInterceptors([depotInterceptor])),
      provideIonicAngular({ mode: 'md' }),
      provideAuth({
        config: {
          authority: config.auth.authority,
          clientId: config.auth.clientId,
          redirectUrl: home,
          postLogoutRedirectUri: home,
          scope: 'openid profile email',
          responseType: 'code',          // authorization code + PKCE; no client secret in the browser
          silentRenew: true,
          useRefreshToken: true,
          renewTimeBeforeTokenExpiresInSeconds: 30,
          logLevel: LogLevel.Warn,
        },
      }),
    ],
  };
}
