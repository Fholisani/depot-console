import { formatBytes } from '../ui/format';
import type { UploadPhase } from './upload.service';

/**
 * The line shown under an upload: "Uploading 42% · 120 MB of 284 MB", "Paused at 42% …",
 * "Connection lost at 42% … continues by itself", "Preparing…", "Finishing…".
 */
export function uploadStatusText(phase: UploadPhase | undefined, percent: number, size?: number): string {
  if (phase === 'queued') {
    return percent > 0 ? `Waiting for its turn (${percent}% kept)` : 'Waiting for its turn…';
  }
  if (phase === 'preparing') {
    return 'Preparing…';
  }
  if (phase === 'finishing') {
    return 'Finishing…';
  }
  const done = size ? ` · ${formatBytes(Math.round((size * percent) / 100))} of ${formatBytes(size)}` : '';
  switch (phase) {
    case 'pausing':
      return `Pausing… finishing the parts already sending (${percent}%${done.replace(' · ', ', ')})`;
    case 'paused':
      return `Paused at ${percent}%${done}`;
    case 'waiting':
      return `Connection lost at ${percent}%${done}. Keep this page open; it continues by itself.`;
    default:
      return `Uploading ${percent}%${done}`;
  }
}
