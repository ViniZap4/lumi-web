// Test double for y-websocket's WebsocketProvider that simulates the
// lumi server's per-note Y.Doc (wsync Room) in-process.
//
// A FakeServer owns one Y.Doc per room, seeded the way the real server
// does it (InitFromText: a fresh doc + insert, i.e. under the SERVER's
// clientID). A FakeProvider bound to a client Y.Doc performs the
// y-protocols handshake (step1/step2 both directions), then relays
// live updates both ways while "connected" — enough to reproduce the
// duplication bug and verify the join rule without a network.

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

type Handler = (...args: any[]) => void;

export class FakeServer {
  docs = new Map<string, Y.Doc>();
  providers: FakeProvider[] = [];
  /** When false, providers connect but never complete the handshake. */
  autoSync = true;

  doc(room: string): Y.Doc {
    let d = this.docs.get(room);
    if (!d) {
      d = new Y.Doc();
      this.docs.set(room, d);
    }
    return d;
  }

  /** Mirror of crdt.Registry.InitFromText. */
  seed(room: string, body: string): void {
    const d = this.doc(room);
    d.getText('content').insert(0, body);
  }

  text(room: string): string {
    return this.doc(room).getText('content').toString();
  }

  reset(): void {
    for (const p of this.providers) p.destroy();
    this.providers = [];
    this.docs.clear();
    this.autoSync = true;
  }
}

export const fakeServer = new FakeServer();

export class FakeProvider {
  readonly awareness: Awareness;
  readonly doc: Y.Doc;
  readonly room: string;
  readonly serverUrl: string;
  /** URL of the current/last connection attempt. */
  url: string;
  /** Every URL dialled, in order (one per connection attempt). */
  urls: string[] = [];
  /** Ticket mode: per-attempt auth params (see ProviderFactoryOpts). */
  private resolveParams: (() => Promise<Record<string, string>>) | null;
  private dialling = false;
  synced = false;
  connected = false;
  shouldConnect = true;
  destroyed = false;
  disconnectCalls = 0;
  private handlers = new Map<string, Set<Handler>>();
  private server: FakeServer;

  private readonly onClientUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.connected) return;
    Y.applyUpdate(this.server.doc(this.room), update, this);
  };

  private readonly onServerUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.connected) return;
    Y.applyUpdate(this.doc, update, this);
  };

  constructor(
    serverUrl: string,
    room: string,
    doc: Y.Doc,
    opts: { params?: Record<string, string>; resolveParams?: () => Promise<Record<string, string>> } = {},
    server: FakeServer = fakeServer,
  ) {
    this.server = server;
    this.doc = doc;
    this.room = room;
    this.serverUrl = serverUrl;
    this.resolveParams = opts.resolveParams ?? null;
    this.url = this.urlFor(opts.params ?? {});
    this.awareness = new Awareness(doc);
    server.providers.push(this);
    doc.on('update', this.onClientUpdate);
    server.doc(room).on('update', this.onServerUpdate);
    queueMicrotask(() => this.open());
  }

  on(ev: string, fn: Handler): void {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
  }

  off(ev: string, fn: Handler): void {
    this.handlers.get(ev)?.delete(fn);
  }

  emit(ev: string, args: unknown[]): void {
    for (const fn of Array.from(this.handlers.get(ev) ?? [])) fn(...args);
  }

  private urlFor(params: Record<string, string>): string {
    return `${this.serverUrl}/${this.room}?${new URLSearchParams(params).toString()}`;
  }

  /** Open the socket and run the y-protocols handshake. In ticket mode
   *  the auth params are resolved first (async), once per attempt, and
   *  a rejection is reported like a socket that closed before opening. */
  open(): void {
    if (this.destroyed || !this.shouldConnect || this.connected || this.dialling) return;
    this.emit('status', [{ status: 'connecting' }]);
    if (this.resolveParams) {
      this.dialling = true;
      this.resolveParams().then(
        (params) => {
          this.dialling = false;
          if (this.destroyed || !this.shouldConnect) return;
          this.url = this.urlFor(params);
          this.connectNow();
        },
        (err) => {
          this.dialling = false;
          if (this.destroyed || !this.shouldConnect) return;
          this.emit('connection-close', [{ code: err?.closeCode ?? 1006 } as CloseEvent, this]);
        },
      );
      return;
    }
    this.connectNow();
  }

  private connectNow(): void {
    this.urls.push(this.url);
    this.connected = true;
    this.emit('status', [{ status: 'connected' }]);
    if (this.server.autoSync) this.handshake();
  }

  /** Server SyncStep1 → client SyncStep2, client SyncStep1 → server SyncStep2. */
  handshake(): void {
    const sdoc = this.server.doc(this.room);
    // Client answers server step1 with its missing updates.
    const toServer = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(sdoc));
    Y.applyUpdate(sdoc, toServer, this);
    // Server answers client step1 → synced.
    const toClient = Y.encodeStateAsUpdate(sdoc, Y.encodeStateVector(this.doc));
    Y.applyUpdate(this.doc, toClient, this);
    if (!this.synced) {
      this.synced = true;
      this.emit('sync', [true]);
    }
  }

  /** Simulate the socket closing with `code` (1006 = abnormal). */
  serverClose(code = 1006, opened = true): void {
    if (opened) {
      this.connected = false;
      this.synced = false;
      this.emit('connection-close', [{ code } as CloseEvent, this]);
      this.emit('status', [{ status: 'disconnected' }]);
      this.emit('sync', [false]);
    } else {
      this.emit('connection-close', [{ code } as CloseEvent, this]);
    }
  }

  disconnect(): void {
    this.disconnectCalls++;
    this.shouldConnect = false;
    this.connected = false;
  }

  /** Reconnect after a drop (what y-websocket's backoff timer does). */
  reconnect(): void {
    this.shouldConnect = true;
    this.open();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disconnect();
    this.doc.off('update', this.onClientUpdate);
    this.server.doc(this.room).off('update', this.onServerUpdate);
    this.awareness.destroy();
    this.handlers.clear();
  }
}

/** Factory with the EditorSession ProviderFactory signature. */
export function fakeProviderFactory(server: FakeServer = fakeServer) {
  return (
    serverUrl: string,
    room: string,
    doc: Y.Doc,
    opts: { params: Record<string, string>; resolveParams?: () => Promise<Record<string, string>> },
  ) =>
    new FakeProvider(serverUrl, room, doc, opts, server);
}

export async function flushMicrotasks(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
