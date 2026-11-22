// In-process fake of the (not yet built) lumi feed server:
// GET /api/info + GET /api/events (SSE) + GET /api/vaults/:v/changes,
// per SPEC-LIVROS §3. Gives tests a fetch() and a manual clock.

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
}

export class FakeStream {
  private ctrl!: ReadableStreamDefaultController<Uint8Array>;
  readonly body: ReadableStream<Uint8Array>;
  closed = false;
  private enc = new TextEncoder();
  constructor(signal?: AbortSignal | null) {
    this.body = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.ctrl = c;
      },
    });
    signal?.addEventListener('abort', () => this.error(new DOMException('aborted', 'AbortError')));
  }
  raw(text: string): void {
    if (this.closed) return;
    this.ctrl.enqueue(this.enc.encode(text));
  }
  send(event: string, data: unknown): void {
    this.raw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  ping(): void {
    this.raw(': ping\n\n');
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ctrl.close();
  }
  error(e: unknown): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ctrl.error(e);
    } catch {
      // already errored
    }
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export class FakeFeedServer {
  /** null = network failure on /api/info. */
  infoStatus: number | null = 200;
  info: unknown = { name: 'fake', version: 'test', protocol: 1, public_key: 'pk', registration: 'closed' };
  /** null = network failure on /api/events. */
  eventsStatus: number | null = 200;
  eventsHeaders: Record<string, string> = {};
  eventsContentType = 'text/event-stream';
  /** Tokens accepted by /api/events. */
  tokens = new Set<string>(['tk']);
  streams: FakeStream[] = [];
  requests: RecordedRequest[] = [];
  /** vault_id → handler for /changes. */
  changes = new Map<string, (after: number) => Response>();
  /** Generic REST routes: "GET /api/vaults" → handler(headers). */
  routes = new Map<string, (headers: Record<string, string>) => Response>();

  constructor(readonly base = 'https://feed.test') {}

  get last(): FakeStream {
    return this.streams[this.streams.length - 1];
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    this.requests.push({ url, headers });
    const path = url.slice(this.base.length);
    if (!url.startsWith(this.base)) throw new TypeError('Failed to fetch');
    const route = this.routes.get(`${init.method ?? 'GET'} ${path}`);
    if (route) return route(headers);
    if (path === '/api/info') {
      if (this.infoStatus == null) throw new TypeError('Failed to fetch');
      if (this.infoStatus !== 200) return json(this.infoStatus, { error: 'not_found' });
      return json(200, this.info);
    }
    if (path.startsWith('/api/events')) {
      if (this.eventsStatus == null) throw new TypeError('Failed to fetch');
      const auth = headers['authorization'] ?? '';
      // ?token= is ignored by contract; only the header counts.
      const tok = auth.startsWith('Bearer ') ? auth.slice(7) : headers['x-lumi-token'];
      if (!tok || !this.tokens.has(tok)) return json(401, { error: 'unauthorized' });
      if (this.eventsStatus !== 200) return json(this.eventsStatus, { error: 'x' }, this.eventsHeaders);
      const s = new FakeStream(init.signal);
      this.streams.push(s);
      return new Response(s.body, {
        status: 200,
        headers: { 'content-type': this.eventsContentType, 'cache-control': 'no-store' },
      });
    }
    const m = /^\/api\/vaults\/([^/]+)\/changes\?after=(\d+)/.exec(path);
    if (m) {
      const h = this.changes.get(m[1]);
      if (!h) return json(404, { error: 'not_found' });
      return h(Number(m[2]));
    }
    return json(404, { error: 'not_found' });
  };
}

/** Deterministic manual clock for setTimeout-driven code. */
export class ManualTimers {
  now = 0;
  private seq = 0;
  private q = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): number => {
    const id = ++this.seq;
    this.q.set(id, { at: this.now + Math.max(0, ms), fn });
    return id;
  };
  clearTimeout = (h: unknown): void => {
    this.q.delete(h as number);
  };
  get pending(): number[] {
    return Array.from(this.q.values()).map((t) => t.at - this.now).sort((a, b) => a - b);
  }
  /** Advance the clock, firing due timers in order. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let nextID = -1;
      let next: { at: number; fn: () => void } | null = null;
      for (const [id, t] of this.q) if (t.at <= target && (!next || t.at < next.at)) { next = t; nextID = id; }
      if (!next) break;
      this.q.delete(nextID);
      this.now = next.at;
      next.fn();
    }
    this.now = target;
  }
}

export async function flush(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}
