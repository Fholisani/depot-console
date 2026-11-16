/**
 * The text handed to a chat app with a share link, so the message itself says what is shared:
 * chat apps cannot read per-link preview tags from the Console (a single-page app), so their
 * preview card only says "Depot Console".
 */
export interface ShareMessage {
  title: string;
  text: string;
  url: string;
}

/** "5 photos and 1 video", "3 items", "1 document". */
export function describeItems(kinds: string[], total: number): string {
  if (kinds.length < total || total === 0) {
    return `${total} ${total === 1 ? 'item' : 'items'}`;
  }
  const count = (k: string): number => kinds.filter((x) => x === k).length;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string): void => {
    if (n > 0) {
      parts.push(`${n} ${n === 1 ? one : many}`);
    }
  };
  add(count('image'), 'photo', 'photos');
  add(count('video'), 'video', 'videos');
  add(count('audio'), 'audio file', 'audio files');
  add(count('pdf') + count('other'), 'document', 'documents');
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** Message for an album link: name, the note (or the album's description), what is in it, the link. */
export function albumMessage(album: { name: string; description?: string | null }, note: string | null | undefined,
                             items: string, sharedBy: string | null | undefined, url: string): ShareMessage {
  const about = (note ?? '').trim() || (album.description ?? '').trim();
  const line = [items, sharedBy ? `shared by ${sharedBy}` : ''].filter(Boolean).join(' · ');
  return { title: album.name, text: [album.name, about, line].filter(Boolean).join('\n'), url };
}

/** Message for a file link: file name, the note, size, the link. */
export function fileMessage(filename: string, note: string | null | undefined, size: string,
                            sharedBy: string | null | undefined, url: string): ShareMessage {
  const line = [size, sharedBy ? `shared by ${sharedBy}` : ''].filter(Boolean).join(' · ');
  return { title: filename, text: [filename, (note ?? '').trim(), line].filter(Boolean).join('\n'), url };
}

/** The whole message as one block of text, for the clipboard. */
export function messageText(m: ShareMessage): string {
  return `${m.text}\n${m.url}`;
}

/** True where the device has a share sheet (phones, some desktops). */
export function canShareNatively(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Opens the device's share sheet with the message. Resolves true when shared, false when the user
 * closed the sheet or the device has none (the caller then copies the text instead).
 */
export async function shareNatively(m: ShareMessage): Promise<boolean> {
  if (!canShareNatively()) {
    return false;
  }
  try {
    // Text and URL together: WhatsApp puts both in the message.
    await navigator.share({ title: m.title, text: m.text, url: m.url });
    return true;
  } catch {
    return false;
  }
}
