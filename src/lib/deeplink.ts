// Deep links into a book / note (SPEC-PARTE2 §8, web side).
//
//   #/b/<vault>                 open the book
//   #/b/<vault>/n/<note-id>     open a note by id
//   #/b/<vault>/p/<note/path.md> open a note by its book-relative path
//
// `<vault>` is the vault UUID (what `lumi open` and `lumi://` carry);
// a book's slug is accepted too. Every segment is URI-decoded and
// validated: no control characters, no `.`/`..` path segments, bounded
// lengths. Hash routing keeps the static host (nginx, Vercel) free of
// rewrites. Pure; the view does the navigation.

export interface DeepLink {
  vault: string;
  note?: string;
  path?: string;
}

const SEG_MAX = 256;
const PATH_MAX = 1024;
const BAD = /[\u0000-\u001f\u007f]/;

function dec(s: string): string | null {
  try {
    const v = decodeURIComponent(s);
    return v && v.length <= SEG_MAX && !BAD.test(v) && !v.includes('/') ? v : null;
  } catch {
    return null;
  }
}

/** Parse `location.hash`; null when it is not a deep link (or invalid). */
export function parseDeepLink(hash: string): DeepLink | null {
  const h = (hash ?? '').replace(/^#/, '');
  if (!h.startsWith('/b/') || h.length > PATH_MAX * 2) return null;
  const parts = h.slice(3).split('/');
  const vault = dec(parts[0] ?? '');
  if (!vault) return null;
  if (parts.length === 1 || (parts.length === 2 && parts[1] === '')) return { vault };
  const kind = parts[1];
  const rest = parts.slice(2);
  if (kind === 'n' && rest.length === 1) {
    const note = dec(rest[0]);
    return note ? { vault, note } : null;
  }
  if (kind === 'p' && rest.length >= 1) {
    const segs: string[] = [];
    for (const r of rest) {
      const s = dec(r);
      if (!s || s === '.' || s === '..') return null;
      segs.push(s);
    }
    const path = segs.join('/');
    return path.length <= PATH_MAX ? { vault, path } : null;
  }
  return null;
}

export function formatDeepLink(l: DeepLink): string {
  const v = encodeURIComponent(l.vault);
  if (l.note) return `#/b/${v}/n/${encodeURIComponent(l.note)}`;
  if (l.path) return `#/b/${v}/p/${l.path.split('/').map(encodeURIComponent).join('/')}`;
  return `#/b/${v}`;
}

export interface BookLike {
  id: string;
  vault_id: string;
}

/** The book a link points at: by vault id, then by book id, then by
 *  slug (from the vault info the app has cached). */
export function resolveBook<B extends BookLike>(l: DeepLink, books: readonly B[], slugOf: (b: B) => string | null | undefined = () => null): B | null {
  return (
    books.find((b) => b.vault_id === l.vault) ??
    books.find((b) => b.id === l.vault) ??
    books.find((b) => slugOf(b) === l.vault) ??
    null
  );
}
