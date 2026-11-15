import { HttpClient, HttpEvent, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from './api-error';
import type {
  ApiKey, CompleteUpload, CopyResult, CreatedApiKey, CreatedWebhook, CreateUpload, DepotObject,
  Envelope, FirstLogin, LifecyclePreview, LifecycleRule, LifecycleRuleBody, Namespace,
  NamespaceSettings, NewApiKey, ObjectResult, OnboardingStep, PartTarget, Progress, RestoreResult,
  SearchResults, SignupRequest, SignupResult, Tags, Upload, UploadStatus, UsageReport, Version,
  Webhook, WebhookBody, WhoAmI,
} from './models';

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
    return this.get<SearchResults>('/v1/search', params);
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

  progress(id: string): Observable<Progress> {
    return this.get<Progress>(`/v1/objects/${id}/progress`);
  }

  /**
   * Content as a blob, streamed through the API so the bearer token never reaches storage. Emits
   * download progress events (XHR backend) and then the response with the blob.
   */
  download(id: string, version?: string): Observable<HttpEvent<Blob>> {
    let params = new HttpParams().set('mode', 'proxy').set('download', 'true');
    if (version) {
      params = params.set('version', version);
    }
    return this.http.get(this.url(`/v1/objects/${id}/content`), {
      params, responseType: 'blob', observe: 'events', reportProgress: true,
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

  partTarget(id: string, partNumber: number): Observable<PartTarget> {
    return this.send<PartTarget>('POST', `/v1/uploads/${id}/parts/${partNumber}`, {});
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
    method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, headers?: Record<string, string>,
  ): Observable<T> {
    return this.http.request<Envelope<T>>(method, this.url(path), { body, headers }).pipe(
      map((r) => r?.data as T),
      catchError((e) => throwError(() => ApiError.from(e))),
    );
  }
}
