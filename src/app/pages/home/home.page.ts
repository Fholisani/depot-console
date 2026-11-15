import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular';

/** Public landing page. Written for people whose phone is full of footage they love. */
@Component({
  selector: 'app-home',
  imports: [IonButton, RouterLink],
  template: `
    <section class="hero">
      <div class="container">
        <p class="eyebrow">For every ride, trip and moment you filmed</p>
        <h1>Stop deleting the videos<br />you love.</h1>
        <p class="lead muted">
          You filmed the climb, edited it on your phone, and then "Storage full". Again. Save your
          finished videos to Depot in full quality, free up your phone, and never choose between an
          old memory and a new one.
        </p>
        <div class="cta">
          <ion-button size="large" routerLink="/signup">Save my videos</ion-button>
          <ion-button size="large" fill="outline" routerLink="/pricing">See pricing</ion-button>
        </div>
        <p class="muted small">Start with 5 GB free. No card needed.</p>
      </div>
    </section>

    <section class="container story card">
      <div>
        <h2>Sound familiar?</h2>
        <ul class="pain">
          <li>Your drone or action-cam footage fills your phone in a weekend.</li>
          <li>You edit the best moments, then have no space to save the result.</li>
          <li>You delete last month's ride to make room for today's.</li>
        </ul>
      </div>
      <div>
        <h2>With Depot</h2>
        <ul class="gain">
          <li>Upload straight from your phone's browser, even long 4K files.</li>
          <li>Every file is kept exactly as you made it. No compression.</li>
          <li>Delete it from your phone. It stays safe in Depot.</li>
        </ul>
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
      <h2>Three steps to a phone with space again</h2>
      <ol>
        <li><strong>Create your account</strong> with just an email and a password.</li>
        <li><strong>Upload your finished videos</strong> from your phone or computer.</li>
        <li><strong>Delete them from your phone</strong>, and download them from Depot whenever you want them back.</li>
      </ol>
      <ion-button routerLink="/signup">Start free</ion-button>
    </section>
  `,
  styles: [`
    .hero { padding: 5rem 0 3rem; text-align: center;
      background: radial-gradient(60rem 24rem at 50% -6rem, var(--depot-accent-soft), transparent); }
    .eyebrow { color: var(--ion-color-primary); font-weight: 600; margin: 0 0 0.75rem; }
    h1 { font-size: clamp(2.1rem, 5.5vw, 3.6rem); line-height: 1.08; margin: 0 0 1.25rem; }
    .lead { font-size: 1.15rem; max-width: 40rem; margin: 0 auto 2rem; line-height: 1.6; }
    .cta { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
    .small { font-size: 0.9rem; margin-top: 1rem; }
    .story { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 2rem;
      margin-top: 1rem; }
    .story h2 { margin-top: 0; font-size: 1.25rem; }
    .story ul { list-style: none; padding: 0; margin: 0; line-height: 1.8; }
    .pain li::before { content: '✕ '; color: #c92a2a; font-weight: 700; }
    .gain li::before { content: '✓ '; color: #2b8a3e; font-weight: 700; }
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
    { icon: '🎬', title: 'Full quality, always', text: 'Your 4K edit comes back byte for byte. Depot checks every file when it arrives.' },
    { icon: '\u{1F4F1}', title: 'Free up your phone', text: 'Keep your camera roll for new moments. Your old ones are a download away.' },
    { icon: '\u{1F558}', title: 'Nothing lost by accident', text: 'Deleted something? Get it back for 30 days. Older versions are kept too.' },
    { icon: '🔎', title: 'Find any ride', text: 'Search by name and add your own tags, like "Drakensberg" or "2026".' },
  ];
}
