import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from './api-error';
import type {
  ApiKey, CreatedApiKey, Envelope, FirstLogin, Namespace, NamespaceSettings, NewApiKey,
  OnboardingStep, SignupRequest, SignupResult, UsageReport, WhoAmI,
} from './models';

/**
 * Typed client for the Depot API. Each method returns the envelope's `data`; failures surface as
 * {@link ApiError}. Add endpoints here as pages need them, with types from the contract.
 */
@Injectable({ providedIn: 'root' })
export class DepotApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiBase.replace(/\/$/, '');

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

  namespaces(): Observable<Namespace[]> {
    return this.get<Namespace[]>('/v1/namespaces');
  }

  createNamespace(settings: NamespaceSettings): Observable<Namespace> {
    return this.send<Namespace>('POST', '/v1/namespaces', settings);
  }

  apiKeys(): Observable<ApiKey[]> {
    return this.get<ApiKey[]>('/v1/api-keys');
  }

  createApiKey(body: NewApiKey): Observable<CreatedApiKey> {
    return this.send<CreatedApiKey>('POST', '/v1/api-keys', body);
  }

  signUp(body: SignupRequest): Observable<SignupResult> {
    return this.send<SignupResult>('POST', '/v1/signup', body);
  }

  // ------------------------------------------------------------------ plumbing

  /** Absolute URL of an API path; the interceptor recognises these to attach credentials. */
  url(path: string): string {
    return this.base + path;
  }

  private get<T>(path: string): Observable<T> {
    return this.http.get<Envelope<T>>(this.url(path)).pipe(
      map((r) => r.data),
      catchError((e) => throwError(() => ApiError.from(e))),
    );
  }

  private send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Observable<T> {
    return this.http.request<Envelope<T>>(method, this.url(path), { body }).pipe(
      map((r) => r?.data as T),
      catchError((e) => throwError(() => ApiError.from(e))),
    );
  }
}
