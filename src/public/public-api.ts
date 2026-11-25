// Anonymous reader for published books (M3, GET /api/public/books/...).
//
// Deliberately separate from lib/api.ts: no account, no token, no
// cookies, no Referer. Nothing here imports the account/session layer,
// and the /p/ route is mounted before the app boots (main.ts), so the
// logged-in token can never reach a public endpoint.

export interface PublicNoteRef {
  id: string;
  path: string;
  title: string;
  kind: 'markdown' | 'canvas';
  updated_at: string;
}
export interface PublicBook {
  name: string;
  notes: PublicNoteRef[];
}
export interface PublicNote extends PublicNoteRef {
  body: string;
}

export class PublicError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62})$/i;

/** `/p/<slug>` or `/p/<slug>/n/<note id>` → parts, else null. */
export function parsePublicPath(pathname: string): { slug: string; noteID: string | null } | null {
  const m = /^\/p\/([^/]+)(?:\/n\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return null;
  let slug: string;
  let note: string | null = null;
  try {
    slug = decodeURIComponent(m[1]);
    if (m[2]) note = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (!SLUG.test(slug)) return null;
  if (note != null && (note.length > 300 || /[/\\]/.test(note))) return null;
  return { slug, noteID: note };
}

export function publicNotePath(slug: string, noteID: string): string {
  return `/p/${encodeURIComponent(slug)}/n/${encodeURIComponent(noteID)}`;
}

function message(status: number, retry: number | null): string {
  if (status === 404) return 'Livro ou nota não encontrado.';
  if (status === 410) return 'Este livro não é mais público.';
  if (status === 429) return retry ? `Muitas leituras seguidas. Tente de novo em ${retry} s.` : 'Muitas leituras seguidas. Aguarde um pouco.';
  if (status === 0) return 'Não foi possível falar com o servidor.';
  return `O servidor respondeu ${status}.`;
}

/** The only fetch the public reader makes: anonymous by construction. */
export async function publicGet<T>(server: string, path: string, f: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await f(server.replace(/\/+$/, '') + path, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new PublicError(0, message(0, null));
  }
  if (!res.ok) {
    let retry: number | null = null;
    try {
      const b = (await res.json()) as { retry_after?: unknown };
      if (typeof b.retry_after === 'number') retry = b.retry_after;
    } catch {
      /* no body */
    }
    if (retry == null) {
      const h = Number(res.headers.get('Retry-After'));
      if (Number.isFinite(h) && h > 0) retry = h;
    }
    throw new PublicError(res.status, message(res.status, retry), retry);
  }
  return (await res.json()) as T;
}

export function getPublicBook(server: string, slug: string, f?: typeof fetch): Promise<PublicBook> {
  return publicGet<PublicBook>(server, `/api/public/books/${encodeURIComponent(slug)}`, f);
}

export function getPublicNote(server: string, slug: string, id: string, f?: typeof fetch): Promise<PublicNote> {
  return publicGet<PublicNote>(server, `/api/public/books/${encodeURIComponent(slug)}/notes/${encodeURIComponent(id)}`, f);
}

/** The server that serves this page's public books: the build's
 *  default server, else this origin. Never taken from the URL (a link
 *  must not make this origin display another server's content). */
export function publicServer(defaultServer: string | null, origin: string): string {
  return (defaultServer || origin).replace(/\/+$/, '');
}
