/** What kind of file something is, as the viewer and the tiles need it. */
export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'other';

const BY_EXTENSION: Record<string, MediaKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image', webp: 'image', avif: 'image', heic: 'image',
  heif: 'image', jfif: 'image', tif: 'image', tiff: 'image', dng: 'image',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', lrf: 'video',
  '3gp': 'video', avi: 'video', mts: 'video', m2ts: 'video',
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

/** What the API says about a file's picture; `poster` (file list) or `thumbnail` (album items). */
export interface PictureInfo {
  filename: string;
  contentType?: string | null;
  poster?: boolean;
  thumbnail?: boolean;
}

/**
 * Whether to ask the API for a file's 480 px picture: photos it can make, and videos once the
 * worker has made their poster (the list says so; asking before would only get a 404).
 */
export function hasThumbnail(f: PictureInfo): boolean {
  if (kindOf(f.filename, f.contentType) === 'video') {
    return f.poster === true || f.thumbnail === true;
  }
  return hasPicture(f.filename, f.contentType);
}

/** A video's length: "0:42", "12:05", "1:02:03". Empty when unknown. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return '';
  }
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** When a video was recorded, as "24 Dec 2023, 20:30" in the viewer's time zone. Empty when unknown. */
export function formatRecorded(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) {
    return '';
  }
  return new Date(t).toLocaleString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** True for names that say nothing, like a camera's "20231224_203005.mp4" or "1703442605.mov". */
export function isNumericName(filename: string): boolean {
  const stem = filename.replace(/\.[^.]+$/, '');
  return /^[\d_\- ]+$/.test(stem);
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

/** What to tell the owner after a link was extended. */
export function extendedMessage(expiresAt: string | null | undefined): string {
  if (!expiresAt) {
    return 'Link extended: it now works until you stop sharing. Same link, nothing to resend.';
  }
  const until = new Date(expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `Link extended: it now works until ${until}. Same link, nothing to resend.`;
}

/** "12 views · 4 downloads · last opened 2 hours ago" for a share link. */
export function linkStats(s: { views: number; downloads: number; lastViewedAt?: string | null }, now = Date.now()): string {
  const views = `${s.views} ${s.views === 1 ? 'view' : 'views'}`;
  const downloads = `${s.downloads} ${s.downloads === 1 ? 'download' : 'downloads'}`;
  const last = s.lastViewedAt ? ` · last opened ${timeAgo(s.lastViewedAt, now)}` : ' · not opened yet';
  return `${views} · ${downloads}${last}`;
}
