import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular';
import { APP_CONFIG } from '../../core/config/app-config';

interface Example {
  id: string;
  title: string;
  intro: string;
  request: string;
  response?: string;
  after?: string;
}

/**
 * Public developer guide: get a key, then the common calls with real requests and responses. The
 * shapes follow the API contract (`contracts/depot.yaml`); the full reference is Swagger.
 */
@Component({
  selector: 'app-docs',
  imports: [IonButton, RouterLink],
  template: `
    <div class="container layout">
      <aside aria-label="On this page">
        <a href="#start" (click)="go($event, 'start')">Get started</a>
        @for (e of examples; track e.id) {
          <a [href]="'#' + e.id" (click)="go($event, e.id)">{{ e.title }}</a>
        }
        <a href="#errors" (click)="go($event, 'errors')">Errors</a>
      </aside>

      <article>
        <h1>Developer guide</h1>
        <p class="muted lead">
          Everything is plain HTTPS and JSON. Any language that can send a web request can use Depot.
        </p>

        <section id="start">
          <h2>Get started</h2>
          <ol>
            <li><a routerLink="/signup">Create an account</a> and open the link in the email.</li>
            <li>Sign in and open <strong>Developers</strong>, then <strong>Create access key</strong>. The key is copied for you.</li>
            <li>Send the key with every request: <code>Authorization: Bearer dpt_…</code></li>
          </ol>
          <p>The examples below use these two shell variables:</p>
          <pre class="code">{{ setup }}</pre>
          <p class="muted">
            Every response has the same envelope: the result in <code>data</code>, problems in
            <code>errors</code>.
          </p>
          <ion-button routerLink="/signup">Get a free account</ion-button>
          <ion-button fill="outline" [href]="base + '/swagger-ui.html'" target="_blank">Full API reference</ion-button>
        </section>

        @for (e of examples; track e.id) {
          <section [id]="e.id">
            <h2>{{ e.title }}</h2>
            <p>{{ e.intro }}</p>
            <p class="label">Request</p>
            <pre class="code">{{ e.request }}</pre>
            @if (e.response) {
              <p class="label">Response</p>
              <pre class="code">{{ e.response }}</pre>
            }
            @if (e.after) { <p class="muted">{{ e.after }}</p> }
          </section>
        }

        <section id="errors">
          <h2>Errors</h2>
          <p>
            Failures use normal HTTP status codes and a stable <code>reason</code> you can branch on.
            Quote the <code>requestId</code> when you ask for help.
          </p>
          <pre class="code">{{ errorExample }}</pre>
          <table>
            <thead><tr><th>Reason</th><th>Status</th><th>What to do</th></tr></thead>
            <tbody>
              @for (r of reasons; track r[0]) {
                <tr><td><code>{{ r[0] }}</code></td><td>{{ r[1] }}</td><td>{{ r[2] }}</td></tr>
              }
            </tbody>
          </table>
        </section>
      </article>
    </div>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 13rem 1fr; gap: 3rem; padding-top: 3rem; }
    aside { position: sticky; top: 1.5rem; align-self: start; display: grid; gap: 0.5rem; font-size: 0.95rem; }
    aside a { color: var(--depot-muted); text-decoration: none; }
    aside a:hover { color: var(--depot-text); }
    article { min-width: 0; }
    h1 { font-size: 2.2rem; margin-top: 0; }
    .lead { font-size: 1.1rem; }
    section { padding-top: 1.5rem; scroll-margin-top: 1rem; }
    ol { line-height: 1.9; }
    .label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--depot-muted);
      margin: 1rem 0 0; }
    table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid var(--depot-border); vertical-align: top; }
    @media (max-width: 52rem) { .layout { grid-template-columns: 1fr; } aside { display: none; } }
  `],
})
export class DocsPage {
  /** Absolute API base as users will call it, e.g. https://fmash.online/depot. */
  protected readonly base = new URL(inject(APP_CONFIG).apiBase, location.origin).href.replace(/\/$/, '');

  protected readonly setup = `export DEPOT=${this.base}
export KEY=dpt_your_key_here`;

  protected readonly examples: Example[] = [
    {
      id: 'check',
      title: 'Check your key',
      intro: 'Returns the account the key belongs to. A quick way to confirm the key works.',
      request: `curl -s "$DEPOT/v1/me" -H "Authorization: Bearer $KEY"`,
      response: `{
  "data": { "tenantId": "5b3df533-779d-4248-8a14-4546542c726d", "tenantSlug": "acme" },
  "errors": [],
  "message": null
}`,
    },
    {
      id: 'upload',
      title: 'Upload a file',
      intro: 'Files up to 64 MB go in one request. The Content-Type you send becomes the file type. '
        + 'Sending the SHA-256 is optional; Depot then rejects the upload if the bytes were damaged on the way.',
      request: `curl -s -X PUT "$DEPOT/v1/objects?namespace=default&filename=report.pdf" \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/pdf" \\
  -H "X-Depot-Sha256: $(sha256sum report.pdf | cut -d' ' -f1)" \\
  --data-binary @report.pdf`,
      response: `HTTP/1.1 201 Created
{
  "data": {
    "objectId": "28d08f7a-cb15-4536-8059-812b59ecb4d1",
    "versionId": "9beb39c1-279f-442a-b092-d25645d0309f",
    "status": "READY",
    "filename": "report.pdf",
    "contentType": "application/pdf",
    "size": 120168,
    "sha256": "153b2514ba38f1129bc1edd15af6db2f2e3f8d58e4e9409a5806315d0ef42af6"
  },
  "errors": [],
  "message": null
}`,
      after: 'Keep the objectId: you use it to download, tag or delete the file. Uploading the same '
        + 'filename again creates a new file; to find files later use search or your own externalRef.',
    },
    {
      id: 'download',
      title: 'Download a file',
      intro: 'Depot answers with a short-lived link straight to storage, so large downloads are fast. '
        + 'Use -L to follow it.',
      request: `curl -sL "$DEPOT/v1/objects/28d08f7a-cb15-4536-8059-812b59ecb4d1/content" \\
  -H "Authorization: Bearer $KEY" -o report.pdf`,
      after: 'Add ?mode=proxy to stream through Depot instead (supports Range for resuming), and '
        + '?version=<versionId> for an older version.',
    },
    {
      id: 'search',
      title: 'Search files',
      intro: 'Free text over file names and your references, plus filters such as folder, type and tags. '
        + 'New files appear within a few seconds.',
      request: `curl -s "$DEPOT/v1/search?q=report&contentType=application/pdf&size=20" \\
  -H "Authorization: Bearer $KEY"`,
      response: `{
  "data": {
    "items": [
      {
        "objectId": "28d08f7a-cb15-4536-8059-812b59ecb4d1",
        "versionId": "9beb39c1-279f-442a-b092-d25645d0309f",
        "namespace": "default",
        "filename": "report.pdf",
        "contentType": "application/pdf",
        "size": 120168,
        "status": "READY",
        "createdAt": "2026-11-14T22:30:12.709Z",
        "updatedAt": "2026-11-14T22:32:14.083Z",
        "tags": { "project": "apollo" }
      }
    ],
    "nextCursor": null
  },
  "errors": [],
  "message": null
}`,
      after: 'When nextCursor is not null, pass it as ?cursor= to get the next page.',
    },
    {
      id: 'tags',
      title: 'Tag a file',
      intro: 'Tags are your own key/value labels (up to 20). This replaces all tags on the file.',
      request: `curl -s -X PUT "$DEPOT/v1/objects/28d08f7a-cb15-4536-8059-812b59ecb4d1/tags" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"tags": {"project": "apollo", "year": "2026"}}'`,
      response: `{ "data": { "project": "apollo", "year": "2026" }, "errors": [], "message": null }`,
      after: 'Then search with ?tag=project:apollo.',
    },
    {
      id: 'delete',
      title: 'Delete and undelete',
      intro: 'Deleting is safe: the file can be restored until it is purged (30 days by default).',
      request: `curl -s -X DELETE "$DEPOT/v1/objects/28d08f7a-cb15-4536-8059-812b59ecb4d1" \\
  -H "Authorization: Bearer $KEY"            # 204 No Content

curl -s -X POST "$DEPOT/v1/objects/28d08f7a-cb15-4536-8059-812b59ecb4d1/undelete" \\
  -H "Authorization: Bearer $KEY"            # 200 with the restored file`,
    },
    {
      id: 'large',
      title: 'Large files',
      intro: 'For files over 64 MB, start an upload session. Depot replies with one signed request per '
        + 'part; send each part straight to storage, then complete the upload with the ETag storage returned for each part.',
      request: `# 1. Start
curl -s -X POST "$DEPOT/v1/uploads" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"namespace": "default", "filename": "video.mp4", "contentType": "video/mp4", "size": 734003200}'

# 2. PUT each part to data.parts[n].request.url (with its headers) and note the ETag header

# 3. Finish
curl -s -X POST "$DEPOT/v1/uploads/<uploadId>/complete" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"parts": [{"partNumber": 1, "etag": "\\"9b2cf535f27731c974343645a3985328\\""}, …]}'`,
      response: `{
  "data": {
    "uploadId": "…", "objectId": "…", "versionId": "…",
    "mode": "MULTIPART", "status": "OPEN",
    "size": 734003200, "partSize": 67108864, "partCount": 11,
    "expiresAt": "2026-11-15T22:30:12Z",
    "parts": [
      { "partNumber": 1, "size": 67108864,
        "request": { "method": "PUT", "url": "https://s3-fmash.xyz/…", "headers": {}, "expiresAt": "…" } }
    ]
  },
  "errors": [], "message": null
}`,
      after: 'Interrupted? GET /v1/uploads/<uploadId> lists the parts still missing, so you can resume.',
    },
  ];

  protected readonly errorExample = `HTTP/1.1 403 Forbidden
{
  "data": null,
  "errors": [{
    "code": 3104,
    "reason": "INSUFFICIENT_SCOPE",
    "message": "This API key cannot write to namespace 'photos'",
    "requestId": "a78e02427f4333f8e2a005b88310dc92"
  }],
  "message": "FORBIDDEN"
}`;

  protected readonly reasons: [string, string, string][] = [
    ['CREDENTIAL_INVALID', '401', 'The key is wrong or revoked. Create a new one.'],
    ['INSUFFICIENT_SCOPE', '403', 'The key is read only or does not cover that folder.'],
    ['VALIDATION_ERROR', '400', 'Fix the field named in errors[0].field.'],
    ['RESOURCE_NOT_FOUND', '404', 'Check the id, and that it belongs to your account.'],
    ['QUOTA_STORAGE_EXCEEDED', '413', 'Storage is full. Delete files or move to a bigger plan.'],
    ['QUOTA_EGRESS_EXCEEDED', '429', 'Monthly downloads used up; resets on the 1st.'],
    ['RATE_LIMITED', '429', 'Slow down and retry after a moment.'],
    ['OBJECT_VERIFYING', '409', 'The file is still being checked. Retry in a few seconds.'],
    ['STORAGE_UNAVAILABLE', '503', 'Temporary. Retry with a short back-off.'],
  ];

  /** In-page links without changing the router URL. */
  protected go(event: Event, id: string): void {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }
}
