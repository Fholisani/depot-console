import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular';

/** Public landing page: one promise, three kinds of files, one action. */
@Component({
  selector: 'app-home',
  imports: [IonButton, RouterLink],
  template: `
    <section class="hero">
      <div class="container">
        <h1>Never delete a memory<br />to make space again.</h1>
        <p class="lead muted">Your photos, videos and documents, kept safe in full quality.</p>
        <ion-button size="large" routerLink="/signup">Start free</ion-button>
        <p class="muted small">5 GB free · No card needed</p>
      </div>
    </section>

    <section class="container kinds">
      @for (k of kinds; track k.title) {
        <div class="card kind">
          <span class="icon" aria-hidden="true">{{ k.icon }}</span>
          <h3>{{ k.title }}</h3>
          <p class="muted">{{ k.text }}</p>
        </div>
      }
    </section>

    <ul class="container trust muted">
      @for (t of trust; track t) { <li>{{ t }}</li> }
    </ul>
  `,
  styles: [`
    .hero { padding: 6rem 0 3.5rem; text-align: center;
      background: radial-gradient(60rem 24rem at 50% -6rem, var(--depot-accent-soft), transparent); }
    h1 { font-size: clamp(2.2rem, 6vw, 3.8rem); line-height: 1.06; margin: 0 0 1rem; }
    .lead { font-size: 1.2rem; margin: 0 auto 2rem; }
    .small { font-size: 0.9rem; margin-top: 0.75rem; }
    .kinds { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1.25rem; }
    .kind { text-align: center; }
    .kind h3 { margin: 0.5rem 0 0.25rem; }
    .kind p { margin: 0; }
    .icon { font-size: 2rem; }
    .trust { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem 2rem; list-style: none;
      margin: 2.5rem auto 0; padding: 0 1.25rem; }
    .trust li::before { content: '\\2713  '; color: var(--ion-color-primary); font-weight: 700; }
  `],
})
export class HomePage {
  protected readonly kinds = [
    { icon: '\u{1F4F7}', title: 'Photos', text: 'Every smile, kept at full resolution.' },
    { icon: '\u{1F3AC}', title: 'Videos', text: 'Long 4K clips, never compressed.' },
    { icon: '\u{1F4C4}', title: 'Documents', text: 'IDs, contracts and receipts, always at hand.' },
  ];

  protected readonly trust = [
    'Checked on arrival',
    'Undo a delete for 30 days',
    'Upload from your phone',
    'Find anything with search',
  ];
}
