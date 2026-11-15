import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular';

/** Public landing page. */
@Component({
  selector: 'app-home',
  imports: [IonButton, RouterLink],
  template: `
    <section class="hero">
      <div class="container">
        <p class="eyebrow">File storage for people and apps</p>
        <h1>Keep every file safe,<br />find it in seconds.</h1>
        <p class="lead muted">
          Upload from your browser or your own software. Depot checks every file, keeps old versions,
          and lets you undo a delete.
        </p>
        <div class="cta">
          <ion-button size="large" routerLink="/signup">Start free</ion-button>
          <ion-button size="large" fill="outline" routerLink="/docs">Read the docs</ion-button>
        </div>
        <p class="muted small">5 GB free. No card needed.</p>
      </div>
    </section>

    <section class="container grid">
      @for (f of features; track f.title) {
        <div class="card feature">
          <span class="icon" aria-hidden="true">{{ f.icon }}</span>
          <h3>{{ f.title }}</h3>
          <p class="muted">{{ f.text }}</p>
        </div>
      }
    </section>

    <section class="container steps">
      <h2>How it works</h2>
      <ol>
        <li><strong>Create an account</strong> with your email. It takes under a minute.</li>
        <li><strong>Upload files</strong> from your browser, or send them from your app with one request.</li>
        <li><strong>Use them anywhere</strong>: download, search, share with a link, or restore an older version.</li>
      </ol>
      <ion-button routerLink="/signup">Create your account</ion-button>
    </section>
  `,
  styles: [`
    .hero { padding: 5rem 0 3rem; text-align: center;
      background: radial-gradient(60rem 24rem at 50% -6rem, var(--depot-accent-soft), transparent); }
    .eyebrow { color: var(--ion-color-primary); font-weight: 600; margin: 0 0 0.75rem; }
    h1 { font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.1; margin: 0 0 1rem; }
    .lead { font-size: 1.15rem; max-width: 38rem; margin: 0 auto 2rem; }
    .cta { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
    .small { font-size: 0.9rem; margin-top: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1.25rem; margin-top: 2rem; }
    .feature h3 { margin: 0.5rem 0; }
    .feature p { margin: 0; }
    .icon { font-size: 1.6rem; }
    .steps { margin-top: 4rem; }
    .steps ol { line-height: 1.9; padding-left: 1.25rem; margin-bottom: 1.5rem; }
  `],
})
export class HomePage {
  protected readonly features = [
    { icon: '🛡️', title: 'Checked on arrival', text: 'Every file is verified with a checksum, so what you get back is exactly what you stored.' },
    { icon: '🕘', title: 'Undo anything', text: 'Old versions are kept and deleted files can be restored for 30 days.' },
    { icon: '🔎', title: 'Find files fast', text: 'Search by name, type or your own tags across everything you have stored.' },
    { icon: '⚡', title: 'Built for apps', text: 'A simple HTTPS API with keys you control. Upload files of any size, in parts.' },
  ];
}
