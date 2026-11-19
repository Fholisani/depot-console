import { HttpClient, HttpEvent, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, retry, throwError, timer } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from './api-error';
import type {
  Album, AlbumAddResult, AlbumItemPage, AlbumMembership, AlbumRemoved, ApiKey, CompleteUpload, CopyResult, CreateAlbum, CreateUpload, CreatedApiKey, CreatedWebhook, DepotObject, DuplicateMatches, Envelope, FileCounts, FileGroupFilter, FilePage, FirstLogin, LifecyclePreview, LifecycleRule, LifecycleRuleBody, Namespace, NamespaceSettings, NewApiKey, ObjectResult, OnboardingStep, PartTarget, Progress, RestoreResult, SearchResults, Share, ShareItemStat, SharedItemPage, SharedLink, SignupRequest, SignupResult, Tags, ThumbnailInfo, UpdateAlbum, Upload, UploadStatus, UsageReport, Version, ViewInfo, Webhook, WebhookBody, WhoAmI,
} from './models';

/** What a shared album item's URL points at: the 480 px tile, the 1600 px preview, or the file. */
export type SharedItemPart = 'thumbnail' | 'preview' | 'content';

export interface SearchQuery {
  q?: string;
  namespace?: string;
  contentType?: string;
  externalRef?: string;
  tag?: string[];
  size?: number;
  cursor?: string;
}

/**
 * Typed client for the Depot API. Each method returns the envelope's `data`; failures surface as
 * {@link ApiError}. Types come from the contract (`models.ts`).
 */
/** Waits before each retry of a search that answered SEARCH_UNAVAILABLE (17s in all). */
export const SEARCH_RETRY_DELAYS_MS = [2000, 5000, 10000];

@Injectable({ providedIn: 'root' })
export class DepotApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBase.replace(/\/$/, '');

  // ------------------------------------------------------------------ signup and tenant

  signUp(body: SignupRequest): Observable<SignupResult> {
    return this.send<SignupResult>('POST', '/v1/signup', body);
  }

  resendVerification(email: string): Observable<void> {
    return this.send<void>('POST', '/v1/signup/resend', { email });
  }

  /** First-login activation and the current tenant (`GET /v1/tenant`). */
  tenant(): Observable<FirstLogin> {
    return this.get<FirstLogin>('/v1/tenant');
  }

  onboarding(): Observable<OnboardingStep[]> {
    return this.get<OnboardingStep[]>('/v1/tenant/onboarding');
  }

  me(): Observable<WhoAmI> {
    return this.get<WhoAmI>('/v1/me');
  }

  usage(): Observable<UsageReport> {
    return this.get<UsageReport>('/v1/usage');
  }

  // ------------------------------------------------------------------ API keys

  apiKeys(): Observable<ApiKey[]> {
    return this.get<ApiKey[]>('/v1/api-keys');
  }

  createApiKey(body: NewApiKey): Observable<CreatedApiKey> {
    return this.send<CreatedApiKey>('POST', '/v1/api-keys', body);
  }

  revokeApiKey(id: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/api-keys/${id}`);
  }

  // ------------------------------------------------------------------ namespaces

  namespaces(): Observable<Namespace[]> {
    return this.get<Namespace[]>('/v1/namespaces');
  }

  namespace(name: string): Observable<Namespace> {
    return this.get<Namespace>(`/v1/namespaces/${name}`);
  }

  createNamespace(settings: NamespaceSettings): Observable<Namespace> {
    return this.send<Namespace>('POST', '/v1/namespaces', settings);
  }

  updateNamespace(name: string, settings: NamespaceSettings): Observable<Namespace> {
    return this.send<Namespace>('PUT', `/v1/namespaces/${name}`, settings);
  }

  deleteNamespace(name: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/namespaces/${name}`);
  }

  lifecycleRules(ns: string): Observable<LifecycleRule[]> {
    return this.get<LifecycleRule[]>(`/v1/namespaces/${ns}/lifecycle-rules`);
  }

  createLifecycleRule(ns: string, body: LifecycleRuleBody): Observable<LifecycleRule> {
    return this.send<LifecycleRule>('POST', `/v1/namespaces/${ns}/lifecycle-rules`, body);
  }

  deleteLifecycleRule(ns: string, id: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/namespaces/${ns}/lifecycle-rules/${id}`);
  }

  setLifecycleRuleEnabled(ns: string, id: string, enabled: boolean): Observable<void> {
    return this.send<void>('POST', `/v1/namespaces/${ns}/lifecycle-rules/${id}/enabled`, { enabled });
  }

  previewLifecycleRule(ns: string, id: string): Observable<LifecyclePreview> {
    return this.get<LifecyclePreview>(`/v1/namespaces/${ns}/lifecycle-rules/${id}/preview`);
  }

  webhooks(ns: string): Observable<Webhook[]> {
    return this.get<Webhook[]>(`/v1/namespaces/${ns}/webhooks`);
  }

  createWebhook(ns: string, body: WebhookBody): Observable<CreatedWebhook> {
    return this.send<CreatedWebhook>('POST', `/v1/namespaces/${ns}/webhooks`, body);
  }

  deleteWebhook(ns: string, id: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/namespaces/${ns}/webhooks/${id}`);
  }

  setWebhookEnabled(ns: string, id: string, enabled: boolean): Observable<void> {
    return this.send<void>('POST', `/v1/namespaces/${ns}/webhooks/${id}/enabled`, { enabled });
  }

  // ------------------------------------------------------------------ objects

  search(query: SearchQuery): Observable<SearchResults> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        value.forEach((v) => (params = params.append(key, v)));
      } else if (value !== undefined && value !== '') {
        params = params.set(key, String(value));
      }
    }
    // Search sits on Elasticsearch, whose disk sometimes stalls for a few seconds; the API then answers
    // SEARCH_UNAVAILABLE. Retry quietly a few times before showing the error, so a short stall only
    // makes the page a little slower.
    return this.get<SearchResults>('/v1/search', params).pipe(
      retry({
        count: SEARCH_RETRY_DELAYS_MS.length,
        delay: (e: unknown, attempt: number) =>
          e instanceof ApiError && e.reason === 'SEARCH_UNAVAILABLE'
            ? timer(SEARCH_RETRY_DELAYS_MS[attempt - 1])
            : throwError(() => e),
      }),
    );
  }

  /** Files newest first from the database (works while search is unavailable). */
  files(query: { namespace?: string; group?: FileGroupFilter; size?: number; cursor?: string }): Observable<FilePage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '' && !(key === 'group' && value === 'all')) {
        params = params.set(key, String(value));
      }
    }
    return this.get<FilePage>('/v1/files', params);
  }

  /** How many files there are per type group. */
  fileCounts(namespace?: string): Observable<FileCounts> {
    const params = namespace ? new HttpParams().set('namespace', namespace) : undefined;
    return this.get<FileCounts>('/v1/files/counts', params);
  }

  /** Which of these files the folder already holds (same name and size). */
  duplicates(namespace: string, files: { filename: string; size: number }[]): Observable<DuplicateMatches> {
    return this.send<DuplicateMatches>('POST', '/v1/files/duplicates', { namespace, files });
  }

  object(id: string): Observable<DepotObject> {
    return this.get<DepotObject>(`/v1/objects/${id}`);
  }

  versions(id: string): Observable<Version[]> {
    return this.get<Version[]>(`/v1/objects/${id}/versions`);
  }

  deleteObject(id: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/objects/${id}`);
  }

  undeleteObject(id: string): Observable<DepotObject> {
    return this.send<DepotObject>('POST', `/v1/objects/${id}/undelete`);
  }

  purgeVersion(id: string, versionId: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/objects/${id}/versions/${versionId}`);
  }

  restoreVersion(id: string, versionId: string): Observable<RestoreResult> {
    return this.send<RestoreResult>('POST', `/v1/objects/${id}/versions/${versionId}/restore`);
  }

  tags(id: string): Observable<Tags> {
    return this.get<Tags>(`/v1/objects/${id}/tags`);
  }

  replaceTags(id: string, tags: Tags): Observable<Tags> {
    return this.send<Tags>('PUT', `/v1/objects/${id}/tags`, { tags });
  }

  copyObject(id: string, namespace: string, externalRef?: string): Observable<CopyResult> {
    return this.send<CopyResult>('POST', `/v1/objects/${id}/copy`, { namespace, externalRef });
  }

  /** The kind of file and a short-lived URL for showing it in a photo or video player. */
  view(id: string, version?: string): Observable<ViewInfo> {
    return this.get<ViewInfo>(`/v1/objects/${id}/view${version ? `?version=${version}` : ''}`);
  }

  /** URL of a small preview picture; fails with 404 for files that have none. */
  thumbnail(id: string): Observable<ThumbnailInfo> {
    return this.get<ThumbnailInfo>(`/v1/objects/${id}/thumbnail`);
  }

  /** URL of a 1600 px picture for the full-screen viewer; fails with 404 for files that have none. */
  preview(id: string): Observable<ThumbnailInfo> {
    return this.get<ThumbnailInfo>(`/v1/objects/${id}/preview`);
  }

  // ------------------------------------------------------------------ albums

  albums(): Observable<Album[]> {
    return this.get<Album[]>('/v1/albums');
  }

  album(id: string): Observable<Album> {
    return this.get<Album>(`/v1/albums/${id}`);
  }

  createAlbum(body: CreateAlbum): Observable<Album> {
    return this.send<Album>('POST', '/v1/albums', body);
  }

  updateAlbum(id: string, body: UpdateAlbum): Observable<Album> {
    return this.send<Album>('PATCH', `/v1/albums/${id}`, body);
  }

  deleteAlbum(id: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/albums/${id}`);
  }

  albumItems(id: string, cursor?: string, limit = 100): Observable<AlbumItemPage> {
    let params = new HttpParams().set('limit', limit);
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.get<AlbumItemPage>(`/v1/albums/${id}/items`, params);
  }

  addToAlbum(id: string, objectIds: string[]): Observable<AlbumAddResult> {
    return this.send<AlbumAddResult>('POST', `/v1/albums/${id}/items`, { objectIds });
  }

  removeFromAlbum(id: string, objectIds: string[]): Observable<AlbumRemoved> {
    return this.send<AlbumRemoved>('DELETE', `/v1/albums/${id}/items`, { objectIds });
  }

  /** Puts the given items first, in this order; the rest keep their order after them. */
  reorderAlbum(id: string, objectIds: string[]): Observable<void> {
    return this.send<void>('PUT', `/v1/albums/${id}/order`, { objectIds });
  }

  /** Which albums each file is in (at most 500 ids). */
  albumMembership(objectIds: string[]): Observable<AlbumMembership[]> {
    return this.send<AlbumMembership[]>('POST', '/v1/albums/membership', { objectIds });
  }

  // ------------------------------------------------------------------ sharing

  createShare(id: string, description: string | null, expiresInDays: number | null): Observable<Share> {
    return this.send<Share>('POST', `/v1/objects/${id}/shares`, { description, expiresInDays });
  }

  shareAlbum(albumId: string, description: string | null, expiresInDays: number | null): Observable<Share> {
    return this.send<Share>('POST', `/v1/albums/${albumId}/shares`, { description, expiresInDays });
  }

  /** Per-item views and downloads of an album link. */
  shareItemStats(shareId: string): Observable<ShareItemStat[]> {
    return this.get<ShareItemStat[]>(`/v1/shares/${shareId}/items`);
  }

  shares(): Observable<Share[]> {
    return this.get<Share[]>('/v1/shares');
  }

  /** Changes a link's note; an empty one removes it. The link itself stays the same. */
  updateShare(shareId: string, description: string | null): Observable<Share> {
    return this.send<Share>('PATCH', `/v1/shares/${shareId}`, { description });
  }

  revokeShare(shareId: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/shares/${shareId}`);
  }

  /** Public (no sign-in): what a visitor is about to open, a file or an album. Counts a view. */
  sharedLink(token: string): Observable<SharedLink> {
    return this.get<SharedLink>(`/v1/share/${encodeURIComponent(token)}`);
  }

  /** Public: one page of a shared album's items. */
  sharedItems(token: string, cursor?: string, limit = 60): Observable<SharedItemPage> {
    let params = new HttpParams().set('limit', limit);
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.get<SharedItemPage>(`/v1/share/${encodeURIComponent(token)}/items`, params);
  }

  /** Public URL of a shared album item's thumbnail, preview or bytes, usable as img/video src or a link. */
  sharedItemUrl(token: string, objectId: string, part: SharedItemPart, download = false): string {
    return this.url(`/v1/share/${encodeURIComponent(token)}/items/${objectId}/${part}`
      + (part === 'content' && download ? '?download=true' : ''));
  }

  /** Public URL of a shared photo's 1600 px preview (file links). */
  sharedPreviewUrl(token: string): string {
    return this.url(`/v1/share/${encodeURIComponent(token)}/preview`);
  }

  /** Public URL of the whole shared album as a ZIP. */
  sharedArchiveUrl(token: string): string {
    return this.url(`/v1/share/${encodeURIComponent(token)}/archive`);
  }

  /** Public URL of a shared file's bytes, for img/video sources and the Download button. */
  sharedContentUrl(token: string, download = false): string {
    return this.url(`/v1/share/${encodeURIComponent(token)}/content${download ? '?download=true' : ''}`);
  }

  progress(id: string): Observable<Progress> {
    return this.get<Progress>(`/v1/objects/${id}/progress`);
  }

  /**
   * Content as a blob, streamed through the API so the bearer token never reaches storage. Emits
   * download progress events (XHR backend) and then the response with the blob.
   */
  download(id: string, version?: string, range?: { from: number; to: number }): Observable<HttpEvent<Blob>> {
    let params = new HttpParams().set('mode', 'proxy').set('download', 'true');
    if (version) {
      params = params.set('version', version);
    }
    // A byte range (inclusive) answers 206 with just that piece; proxy mode supports Range.
    const headers = range ? new HttpHeaders({ Range: `bytes=${range.from}-${range.to}` }) : undefined;
    return this.http.get(this.url(`/v1/objects/${id}/content`), {
      params, headers, responseType: 'blob', observe: 'events', reportProgress: true,
    }).pipe(catchError((e) => throwError(() => ApiError.from(e))));
  }

  // ------------------------------------------------------------------ uploads

  /** Single-request upload for files up to 64 MiB, with upload progress events. */
  uploadSimple(
    namespace: string, file: File, sha256?: string,
  ): Observable<HttpEvent<Envelope<ObjectResult>>> {
    let params = new HttpParams().set('namespace', namespace).set('filename', file.name);
    let headers = new HttpHeaders({ 'Content-Type': file.type || 'application/octet-stream' });
    if (sha256) {
      headers = headers.set('X-Depot-Sha256', sha256);
    }
    return this.http.put<Envelope<ObjectResult>>(this.url('/v1/objects'), file, {
      params, headers, observe: 'events', reportProgress: true,
    }).pipe(catchError((e) => throwError(() => ApiError.from(e))));
  }

  createUpload(body: CreateUpload, idempotencyKey: string): Observable<Upload> {
    return this.send<Upload>('POST', '/v1/uploads', body, { 'Idempotency-Key': idempotencyKey });
  }

  uploadStatus(id: string): Observable<UploadStatus> {
    return this.get<UploadStatus>(`/v1/uploads/${id}`);
  }

  /** A presigned request for one part, signed with the part's base64 SHA-256 (the API requires it). */
  partTarget(id: string, partNumber: number, sha256Base64: string): Observable<PartTarget> {
    return this.send<PartTarget>('POST', `/v1/uploads/${id}/parts/${partNumber}`, { sha256: sha256Base64 });
  }

  completeUpload(id: string, body: CompleteUpload): Observable<ObjectResult> {
    return this.send<ObjectResult>('POST', `/v1/uploads/${id}/complete`, body);
  }

  abortUpload(id: string): Observable<void> {
    return this.send<void>('DELETE', `/v1/uploads/${id}`);
  }

  // ------------------------------------------------------------------ plumbing

  /** Absolute URL of an API path; the interceptor recognises these to attach credentials. */
  url(path: string): string {
    return this.base + path;
  }

  private get<T>(path: string, params?: HttpParams): Observable<T> {
    return this.http.get<Envelope<T>>(this.url(path), { params }).pipe(
      map((r) => r.data),
      catchError((e) => throwError(() => ApiError.from(e))),
    );
  }

  private send<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers?: Record<string, string>,
  ): Observable<T> {
    return this.http.request<Envelope<T>>(method, this.url(path), { body, headers }).pipe(
      map((r) => r?.data as T),
      catchError((e) => throwError(() => ApiError.from(e))),
    );
  }
}
