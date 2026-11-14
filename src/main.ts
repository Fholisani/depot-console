import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadAppConfig } from './app/core/config/app-config';

loadAppConfig()
  .then((config) => bootstrapApplication(App, appConfig(config)))
  .catch((err) => {
    console.error(err);
    document.body.innerHTML =
      '<p style="font-family:sans-serif;padding:2rem">Depot Console could not start: ' +
      String(err?.message ?? err).replace(/[<>&]/g, '') + '</p>';
  });
