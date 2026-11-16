import { firstValueFrom } from 'rxjs';
import type { DepotApi } from '../api/depot-api.service';
import type { MediaKind } from './media';
import type { ViewerItem, ViewerSourceFn } from './media-viewer';

/**
 * Viewer sources for a signed-in user: photos use the 1600 px preview (no egress) and fall back to
 * the original; videos, audio and PDFs use the short-lived view URL.
 */
export function ownerSource(api: DepotApi): ViewerSourceFn {
  return async (item: ViewerItem) => {
    if (item.kind === 'image') {
      try {
        return { kind: 'image' as MediaKind, url: (await firstValueFrom(api.preview(item.id))).url };
      } catch {
        // no preview (for example HEIC or a very large photo): try the original below
      }
    }
    if (item.kind === 'other') {
      return { kind: 'other' as MediaKind, url: null };
    }
    const v = await firstValueFrom(api.view(item.id));
    return { kind: v.kind as MediaKind, url: v.url ?? null };
  };
}

/** The file page of an item, for the viewer's Details link. */
export function fileDetails(item: ViewerItem): unknown[] {
  return ['/app/files', item.id];
}
