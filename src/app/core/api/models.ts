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
/** Every field is optional on the wire: create applies defaults, update keeps what is missing. */
export type NamespaceSettings = Partial<Schemas['NamespaceSettings']>;
export type UsageReport = Schemas['UsageReport'];
export type ApiKey = Schemas['ApiKey'];
export type CreatedApiKey = Schemas['CreatedApiKey'];
export type NewApiKey = Schemas['NewApiKey'];
export type SignupRequest = Schemas['SignupRequest'];
export type SignupResult = Schemas['SignupResult'];

export type CreateUpload = Schemas['CreateUpload'];
export type Upload = Schemas['Upload'];
export type UploadStatus = Schemas['UploadStatus'];
export type PartTarget = Schemas['PartTarget'];
export type CompleteUpload = Schemas['CompleteUpload'];
export type ObjectResult = Schemas['ObjectResult'];
export type DepotObject = Schemas['Object'];
export type Version = Schemas['Version'];
export type VersionStatus = Schemas['VersionStatus'];
export type RestoreResult = Schemas['RestoreResult'];
export type CopyResult = Schemas['CopyResult'];
export type Tags = Schemas['Tags'];
export type SearchHit = Schemas['SearchHit'];
export type SearchResults = Schemas['SearchResults'];
export type Progress = Schemas['Progress'];
export type ViewInfo = Schemas['ViewInfo'];
export type Share = Schemas['Share'];
export type ThumbnailInfo = Schemas['ThumbnailInfo'];
export type SharedFile = Schemas['SharedFile'];
export type LifecycleRule = Schemas['LifecycleRule'];
export type LifecycleRuleBody = Schemas['LifecycleRuleBody'];
export type LifecyclePreview = Schemas['LifecyclePreview'];
export type Webhook = Schemas['Webhook'];
export type WebhookBody = Schemas['WebhookBody'];
export type CreatedWebhook = Schemas['CreatedWebhook'];

export type DepotError = Schemas['Error'];
export type ErrorReason = Schemas['ErrorReason'];
export type ErrorEnvelope = Schemas['ErrorEnvelope'];

/** The success envelope every JSON response under `/v1` uses. */
export interface Envelope<T> {
  data: T;
  errors: [];
  message: null;
}
