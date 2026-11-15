/**
 * Files the user just deleted, hidden from the Files list at once. The list comes from the search
 * index, which is updated from events a few seconds later; this bridges that gap for this tab.
 */
const KEY = 'depot.hiddenObjects';

function read(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function write(ids: Set<string>): void {
  sessionStorage.setItem(KEY, JSON.stringify([...ids].slice(-200)));
}

export function hideObject(id: string): void {
  const ids = read();
  ids.add(id);
  write(ids);
}

export function unhideObject(id: string): void {
  const ids = read();
  ids.delete(id);
  write(ids);
}

export function hiddenObjects(): Set<string> {
  return read();
}
