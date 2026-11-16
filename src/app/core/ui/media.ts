/** What kind of file something is, as the viewer and the tiles need it. */
export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'other';

const BY_EXTENSION: Record<string, MediaKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image', webp: 'image', avif: 'image', heic: 'image',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', lrf: 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio',
  pdf: 'pdf',
};

/**
 * The kind of a file from its stored type, or from its extension when the type is missing or
 * generic (`application/octet-stream`), the same rule the API uses.
 */
export function kindOf(filename: string, contentType?: string | null): MediaKind {
  const type = (contentType ?? '').toLowerCase().split(';')[0].trim();
  const generic = !type || type === 'application/octet-stream' || type === 'binary/octet-stream';
  if (!generic) {
    if (type.startsWith('image/')) {
      return 'image';
    }
    if (type.startsWith('video/')) {
      return 'video';
    }
    if (type.startsWith('audio/')) {
      return 'audio';
    }
    if (type === 'application/pdf') {
      return 'pdf';
    }
  }
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? (BY_EXTENSION[filename.slice(dot + 1).toLowerCase()] ?? 'other') : 'other';
}

/** Photos the service can make thumbnails and previews of. */
export function hasPicture(filename: string, contentType?: string | null): boolean {
  const type = (contentType ?? '').toLowerCase();
  return /^image\/(jpeg|png|gif|bmp)/.test(type) || /\.(jpe?g|png|gif|bmp)$/i.test(filename);
}

/** A tile icon for files without a picture. */
export function kindIcon(kind: MediaKind): string {
  switch (kind) {
    case 'video': return '🎬';
    case 'audio': return '🎵';
    case 'image': return '🖼';
    case 'pdf': return '📕';
    default: return '📄';
  }
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago", else a date. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return 'never';
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return 'never';
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (seconds < 60) {
    return 'just now';
  }
  if (seconds < 3600) {
    return plural(Math.floor(seconds / 60), 'minute');
  }
  if (seconds < 86_400) {
    return plural(Math.floor(seconds / 3600), 'hour');
  }
  if (seconds < 30 * 86_400) {
    return plural(Math.floor(seconds / 86_400), 'day');
  }
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "12 views · 4 downloads · last opened 2 hours ago" for a share link. */
export function linkStats(s: { views: number; downloads: number; lastViewedAt?: string | null }, now = Date.now()): string {
  const views = `${s.views} ${s.views === 1 ? 'view' : 'views'}`;
  const downloads = `${s.downloads} ${s.downloads === 1 ? 'download' : 'downloads'}`;
  const last = s.lastViewedAt ? ` · last opened ${timeAgo(s.lastViewedAt, now)}` : ' · not opened yet';
  return `${views} · ${downloads}${last}`;
}
