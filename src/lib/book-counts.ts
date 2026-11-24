// Last known note count per book (vault id), for the Livros list in
// the floating explorer: only the open book's notes are in memory, so
// the others show the count from the last time they were listed on
// this device. Per-viewer convenience; missing = unknown (not shown).

const KEY = 'lumi.v2.bookcounts';

function store(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function read(): Record<string, number> {
  try {
    const o = JSON.parse(store()?.getItem(KEY) ?? '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export function noteCountOf(vaultID: string): number | null {
  const n = read()[vaultID];
  return typeof n === 'number' && n >= 0 ? n : null;
}

export function rememberNoteCount(vaultID: string, n: number): void {
  const o = read();
  if (o[vaultID] === n) return;
  o[vaultID] = n;
  try {
    store()?.setItem(KEY, JSON.stringify(o));
  } catch {
    /* quota / private mode */
  }
}
