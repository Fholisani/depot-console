/**
 * Friendly names for the types generated from Depot's contract (`contracts/depot.yaml`, kept in
 * sync with `depot/web/src/main/resources/contracts/depot.yaml` by `npm run contract:sync`).
 * Never hand-write a request or response shape: add it here from the generated `components`.
 */
import type { components } from './schema';

type Schemas = components['schemas'];

export type TenantInfo = Schemas['TenantInfo'];
export type FirstLogin = Schemas['FirstLogin'];
export type OnboardingStep = Schemas['OnboardingStep'];
export type WhoAmI = Schemas['WhoAmI'];
export type Namespace = Schemas['Namespace'];
export type NamespaceSettings = Schemas['NamespaceSettings'];
export type UsageReport = Schemas['UsageReport'];
export type ApiKey = Schemas['ApiKey'];
export type CreatedApiKey = Schemas['CreatedApiKey'];
export type NewApiKey = Schemas['NewApiKey'];
export type SignupRequest = Schemas['SignupRequest'];
export type SignupResult = Schemas['SignupResult'];

export type DepotError = Schemas['Error'];
export type ErrorReason = Schemas['ErrorReason'];
export type ErrorEnvelope = Schemas['ErrorEnvelope'];

/** The success envelope every JSON response under `/v1` uses. */
export interface Envelope<T> {
  data: T;
  errors: [];
  message: null;
}
