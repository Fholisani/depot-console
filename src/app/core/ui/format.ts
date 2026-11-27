import { ApiError } from '../api/api-error';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 1536 → "1.5 KB". Uses 1024-based units, as the plans do. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) {
    return '-';
  }
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 2 : 1)} ${UNITS[unit]}`;
}

/** Message per reason that every page shares; pages add their own on top. */
const COMMON: Partial<Record<ApiError['reason'], string>> = {
  NETWORK_ERROR: 'Depot could not be reached. Check your connection and try again.',
  INSUFFICIENT_ROLE: 'Your role in this tenant does not allow that. Ask an owner or admin.',
  INSUFFICIENT_SCOPE: 'This key does not cover that folder, or it is read only.',
  TENANT_SUSPENDED: 'This tenant is suspended or its first login is not finished.',
  EMAIL_NOT_VERIFIED: 'Verify your email address using the link we sent, then sign in again.',
  TENANT_NOT_RESOLVED: 'Your account is not part of a tenant yet.',
  TENANT_SELECTION_REQUIRED: 'You belong to several tenants; choose one to continue.',
  SEARCH_UNAVAILABLE: 'Search is temporarily unavailable. Try again shortly.',
  STORAGE_UNAVAILABLE: 'Storage is temporarily unavailable. Try again shortly.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  QUOTA_STORAGE_EXCEEDED: 'Your storage quota is used up. Delete files or ask for a larger plan.',
  QUOTA_EGRESS_EXCEEDED: 'Your monthly download allowance is used up.',
  NAMESPACE_NOT_EMPTY: 'That folder still has files. Delete them first.',
  NAMESPACE_EXISTS: 'A folder with that name already exists.',
  NAMESPACE_PROTECTED: 'The default folder cannot be deleted.',
  PRECONDITION_FAILED: 'This item changed in the meantime. Reload and try again.',
};

/** Text to show a user for a failed call; `extra` overrides the shared messages. */
export function describeError(
  e: ApiError, extra: Partial<Record<ApiError['reason'], string>> = {},
): string {
  const text = extra[e.reason] ?? COMMON[e.reason] ?? e.message;
  return e.requestId && !(e.reason in extra) && !(e.reason in COMMON) ? `${text} (request ${e.requestId})` : text;
}

/** A price in cents, e.g. 1500 ZAR → "R15"; 0 → "Free". Cents show only when there are any. */
export function formatMoney(cents: number, currency: string): string {
  if (cents === 0) {
    return 'Free';
  }
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100).replace(/^(\D+?)\s/, '$1');
}

/** A plan size without needless decimals: 50 GiB → "50 GB", 1.5 GiB → "1.50 GB". */
export function formatPlanSize(bytes: number): string {
  return formatBytes(bytes).replace(/\.0+ /, ' ');
}
