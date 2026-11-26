// Mock lumi-server for the headless canvas perf check (scripts/perf/canvas-perf.mjs).
//
// One origin serves the production bundle (dist/) AND a minimal v2 API +
// Yjs sync socket, so the CSP's 'self' covers everything. Not a real
// server: no persistence, one user, one book. Test-only.
//
//   node scripts/perf/mock-server.mjs [port]
//
// Control endpoints (perf driver):
//   POST /__ctl/remote?note=<id>&n=<count>&ms=<interval>  remote edits from a
//        server-side Y client (moves a node), broadcast to every socket.
//   GET  /__ctl/stats  request counters per route.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.DIST || path.resolve(here, '../../dist'));
const PORT = Number(process.argv[2] || process.env.PORT || 4777);
const VAULT = 'v1';
const NOW = '2026-11-24T10:00:00Z';

// ---- fixtures ------------------------------------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const sides = ['top', 'right', 'bottom', 'left'];
function bigCanvas(nNodes = 300, nEdges = 400) {
  const r = rng(42);
  const nodes = [];
  // 6 groups of 50 cards each.
  for (let g = 0; g < 6; g++) {
    const gx = (g % 3) * 2600;
    const gy = Math.floor(g / 3) * 2200;
    nodes.push({ id: `g${g}`, type: 'group', label: `Group ${g}`, x: gx - 40, y: gy - 60, width: 2500, height: 2100, color: String((g % 6) + 1) });
  }
  for (let i = 0; nodes.length < nNodes + 6; i++) {
    const g = i % 6;
    const gx = (g % 3) * 2600;
    const gy = Math.floor(g / 3) * 2200;
    const k = Math.floor(i / 6);
    const base = { id: `n${i}`, x: gx + (k % 7) * 340, y: gy + Math.floor(k / 7) * 260, width: 300, height: 200 };
    const t = i % 5;
    if (t === 0) nodes.push({ ...base, type: 'file', file: `notes/note-${i % 20}.md` });
    else if (t === 1) nodes.push({ ...base, type: 'link', url: `https://example.com/page/${i}` });
    else if (t === 2) nodes.push({ ...base, type: 'file', file: `img/pic-${i}.png` });
    else nodes.push({ ...base, type: 'text', text: `# Card ${i}\n\nSome **bold** text, a [[link]] and a list:\n\n- one\n- two\n- three ${'lorem ipsum '.repeat(4)}`, color: i % 7 === 0 ? '#3366ff' : undefined });
  }
  const cards = nodes.filter((n) => n.type !== 'group');
  const edges = [];
  for (let i = 0; i < nEdges; i++) {
    const a = cards[Math.floor(r() * cards.length)];
    let b = cards[Math.floor(r() * cards.length)];
    if (a === b) b = cards[(cards.indexOf(a) + 1) % cards.length];
    edges.push({ id: `e${i}`, fromNode: a.id, fromSide: sides[i % 4], toNode: b.id, toSide: sides[(i + 2) % 4], label: i % 9 === 0 ? `edge ${i}` : undefined, toEnd: 'arrow' });
  }
  return JSON.stringify({ nodes, edges }, null, '\t');
}
const smallCanvas = JSON.stringify(
  {
    nodes: [
      { id: 'a', type: 'text', text: 'Hello **canvas**', x: 0, y: 0, width: 250, height: 60 },
      { id: 'b', type: 'file', file: 'notes/note-1.md', x: 400, y: 0, width: 400, height: 300 },
      { id: 'c', type: 'link', url: 'https://example.com', x: 0, y: 200, width: 250, height: 100 },
    ],
    edges: [{ id: 'ab', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' }],
  },
  null,
  2,
);
// Obsidian writes tabs, extra props, colors as strings, and nodes w/o width on groups' children etc.
const obsidianCanvas = `{
\t"nodes":[
\t\t{"id":"8a1b2c3d4e5f6071","type":"group","x":-300,"y":-200,"width":900,"height":600,"label":"Ideas","color":"4"},
\t\t{"id":"1b2c3d4e5f607182","type":"text","text":"Obsidian card","x":-260,"y":-140,"width":250,"height":60,"color":"1"},
\t\t{"id":"2c3d4e5f60718293","type":"file","file":"notes/note-2.md","x":40,"y":-140,"width":400,"height":400},
\t\t{"id":"3d4e5f60718293a4","type":"file","file":"notes/note-3.md","subpath":"#Heading","x":-260,"y":0,"width":250,"height":200},
\t\t{"id":"4e5f60718293a4b5","type":"link","url":"https://obsidian.md","x":-260,"y":260,"width":250,"height":100}
\t],
\t"edges":[
\t\t{"id":"5f60718293a4b5c6","fromNode":"1b2c3d4e5f607182","fromSide":"right","toNode":"2c3d4e5f60718293","toSide":"left","color":"2"},
\t\t{"id":"60718293a4b5c6d7","fromNode":"3d4e5f60718293a4","fromSide":"bottom","toNode":"4e5f60718293a4b5","toSide":"top","label":"see"}
\t]
}`;

const notes = new Map(); // id -> {path,title,kind,body}
function addNote(id, p, body, kind, frontmatter = {}) {
  notes.set(id, { id, path: p, title: path.basename(p).replace(/\.(md|canvas)$/, ''), kind: kind ?? (p.endsWith('.canvas') ? 'canvas' : 'markdown'), body, frontmatter });
}
for (let i = 0; i < 20; i++) addNote(`note-${i}`, `notes/note-${i}.md`, `# Note ${i}\n\n${'Paragraph with *text* and `code`.\n\n'.repeat(30)}`);
addNote('readme', 'README.md', '# Readme\n\nA markdown note beside the canvases.\n');
addNote('small', 'small.canvas', smallCanvas);
addNote('big', 'big.canvas', bigCanvas());
addNote('empty', 'empty.canvas', '{"nodes":[],"edges":[]}');
addNote('obsidian', 'obsidian.canvas', obsidianCanvas);
// Owner screenshot: a canvas and a markdown note both titled "test"; a board.
addNote('test-canvas', 'test.canvas', smallCanvas);
addNote('test-md', 'test.md', '# test\n\nA markdown note named like the canvas.\n');
addNote('board', 'board.md', '## Todo\n\n- [ ] pack\n- [ ] tickets [[README]]\n- [ ] visa\n\n## Doing\n\n- [ ] route\n\n## Done\n\n- [x] plan\n', 'markdown', { 'kanban-plugin': 'board' });
// Showcase note for prose / motion screenshots (every markdown feature).
addNote('showcase', 'Showcase.md', [
  '# Field notes: the river project',
  '',
  'A **rich** sample with *emphasis*, ~~struck~~ text, ==a highlight==, `inline code`, a [[README]] link and an [external one](https://example.com). Tagged #research #design/motion #lumi.',
  '',
  '## Goals and scope',
  '',
  'Footnotes work too[^1]. Lists carry accent markers:',
  '',
  '- Survey the **north bank** before the rains',
  '- Map *every* inlet',
  '  - nested item with `code`',
  '1. First ordered step',
  '2. Second ordered step',
  '',
  '- [x] Buy waders',
  '- [ ] Calibrate the sensor',
  '',
  '### Measurements',
  '',
  '| Site | Depth (m) | Flow | Notes |',
  '|---|---:|---:|---|',
  '| A1 | 1.20 | 0.8 | clear |',
  '| B2 | 2.45 | 1.3 | silty |',
  '| C3 | 0.70 | 0.4 | reeds |',
  '| D4 | 3.10 | 2.1 | fast |',
  '',
  '#### Sensor code',
  '',
  '```ts',
  '// Read the gauge and smooth it',
  'export async function read(id: string): Promise<number> {',
  '  const raw = await gauge.sample(id, { window: 32 });',
  '  return raw.reduce((a, b) => a + b, 0) / raw.length; // mean',
  '}',
  '```',
  '',
  '> Rivers are roads which move, and which carry us whither we desire to go.',
  '> — *Pascal*',
  '',
  '> [!note] Note',
  '> Callouts keep their own semantic colour.',
  '',
  '> [!tip] Tip',
  '> Measure at dawn when the wind is still.',
  '',
  '> [!warning] Warning',
  '> The east bank is unstable after rain.',
  '',
  '> [!danger] Danger',
  '> Never wade alone above 1.5 m.',
  '',
  '##### Small heading',
  '',
  'Press <kbd>Ctrl</kbd> + <kbd>S</kbd> to save.',
  '',
  '---',
  '',
  '[^1]: Footnotes sit at the end, quietly.',
  '',
].join('\n'));
for (let i = 0; i < 14; i++) addNote(`log-${i}`, `journal/2026-11-${String(10 + i).padStart(2, '0')}.md`, `# Day ${i + 1}\n\n## Morning\n\nWalked the ${i % 2 ? 'north' : 'south'} bank.\n\n## Afternoon\n\n- logged depth\n- **cleaned** the gauge\n\n${'A quiet paragraph about the water and the light. '.repeat(6)}\n`);
addNote('invalid', 'invalid.canvas', '{"nodes":[{"id":"x","type":"text","text":"broken",');
// Extra notes for a check script: MOCK_EXTRA_NOTES=<file.json> holding
// [{ "id", "path", "body" }] (scripts/perf/no-remote-requests.mjs).
if (process.env.MOCK_EXTRA_NOTES) {
  for (const n of JSON.parse(fs.readFileSync(process.env.MOCK_EXTRA_NOTES, 'utf8'))) addNote(n.id, n.path, n.body);
}

// ---- Yjs docs ------------------------------------------------------------------------------
const docs = new Map(); // id -> {doc, awareness, conns:Set}
function docFor(id) {
  let d = docs.get(id);
  if (d) return d;
  const doc = new Y.Doc();
  doc.getText('content').insert(0, notes.get(id)?.body ?? '');
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  d = { doc, awareness, conns: new Set() };
  doc.on('update', (update, origin) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    for (const c of d.conns) if (c !== origin) c.send(msg);
    const n = notes.get(id);
    if (n) n.body = doc.getText('content').toString();
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const msg = encoding.toUint8Array(enc);
    for (const c of d.conns) c.send(msg);
  });
  docs.set(id, d);
  return d;
}
const b64 = (u8) => Buffer.from(u8).toString('base64');
// The client reads the text type name from the session; find it.
// (editor-session uses ydoc.getText('content') — verified by the driver: canvas renders.)

// ---- HTTP ----------------------------------------------------------------------------------
const stats = {};
const user = { id: 'u1', username: 'admin', display_name: 'Admin' };
const vault = { id: VAULT, slug: 'book', name: 'Perf Book', created_by: 'u1', created_at: NOW, owner_user_id: 'u1', head: 1, role: 'Admin', can_edit: true };
const summary = (n) => ({ id: n.id, vault_id: VAULT, path: n.path, title: n.title, created_at: NOW, updated_at: NOW, kind: n.kind, crdt_epoch: 'e1' });
const ADMIN_CAPS = ['vault.read', 'vault.manage', 'note.read', 'note.create', 'note.edit', 'note.delete', 'members.manage', 'roles.manage', 'invites.manage', 'comment'];

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };

let remoteTimers = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
    return res.end();
  }
  if (p.startsWith('/api/') || p.startsWith('/__ctl/')) {
    const key = req.method + ' ' + p.replace(/notes\/[^/]+/, 'notes/:id');
    stats[key] = (stats[key] || 0) + 1;
  }
  if (p === '/__ctl/stats') return json(res, 200, stats);
  if (p === '/__ctl/reset') {
    for (const k of Object.keys(stats)) delete stats[k];
    return json(res, 200, {});
  }
  if (p === '/__ctl/remote') {
    const id = u.searchParams.get('note');
    const count = Number(u.searchParams.get('n') || 50);
    const ms = Number(u.searchParams.get('ms') || 50);
    const d = docFor(id);
    let i = 0;
    const t = setInterval(() => {
      const yt = d.doc.getText('content');
      const s = yt.toString();
      // Move the first numeric "x" by one (a minimal remote edit like a peer's drag).
      const m = /"x":\s*(-?\d+)/.exec(s);
      if (m) {
        const at = m.index + m[0].length - m[1].length;
        d.doc.transact(() => {
          yt.delete(at, m[1].length);
          yt.insert(at, String(Number(m[1]) + 1));
        }, 'remote-peer');
      }
      if (++i >= count) clearInterval(t);
    }, ms);
    remoteTimers.push(t);
    return json(res, 200, { ok: true });
  }
  // M3 public reader (/p/:slug): anonymous; records whether any auth leaked.
  if (p === '/api/public/books/demo' || p.startsWith('/api/public/books/demo/notes/')) {
    if (req.headers.authorization || req.headers['x-lumi-token'] || req.headers.cookie) stats.publicAuthLeaks = (stats.publicAuthLeaks ?? 0) + 1;
    const pub = [...notes.values()].filter((n) => n.id === 'showcase' || n.id === 'small');
    if (p === '/api/public/books/demo') return json(res, 200, { name: 'Demo público', notes: pub.map((n) => ({ id: n.id, path: n.path, title: n.title, kind: n.kind, updated_at: NOW })) });
    const n = notes.get(decodeURIComponent(p.slice('/api/public/books/demo/notes/'.length)));
    if (!n || !pub.includes(n)) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { id: n.id, path: n.path, title: n.title, kind: n.kind, updated_at: NOW, body: n.body });
  }
  if (p === '/api/info') return json(res, 200, { name: 'mock', version: 'mock', protocol: 2, registration: false });
  if (p === '/api/auth/login') return json(res, 200, { token: 'tok', expires_at: '2099-01-01T00:00:00Z', user });
  if (p === '/api/auth/logout') return json(res, 204);
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
    res.write(': hello\n\n');
    const t = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => clearInterval(t));
    return;
  }
  if (p === '/api/users/me') return json(res, 200, user);
  if (p === '/api/vaults') return json(res, 200, { vaults: [vault] });
  if (p === `/api/vaults/${VAULT}`) return json(res, 200, vault);
  if (p === `/api/vaults/${VAULT}/members`) return json(res, 200, { members: [{ vault_id: VAULT, user_id: 'u1', role_id: 'r1', username: 'admin', display_name: 'Admin', role_name: 'Admin', capabilities: ADMIN_CAPS, joined_at: NOW }] });
  if (p === `/api/vaults/${VAULT}/roles`) return json(res, 200, { roles: [{ id: 'r1', vault_id: VAULT, name: 'Admin', capabilities: ADMIN_CAPS, is_seed: true }] });
  if (p === `/api/vaults/${VAULT}/changes`) return json(res, 200, { notes: [], deleted: [], head: 1, more: false });
  if (p === `/api/vaults/${VAULT}/notes` && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const inp = JSON.parse(raw || '{}');
      const canvas = inp.kind === 'canvas';
      const base = String(inp.title || 'untitled').replace(/\.(md|canvas)$/i, '');
      const id = base.replace(/[^a-z0-9/-]+/gi, '-').toLowerCase();
      addNote(id, base + (canvas ? '.canvas' : '.md'), inp.body || (canvas ? '{"nodes":[],"edges":[]}\n' : ''), canvas ? 'canvas' : 'markdown');
      json(res, 201, summary(notes.get(id)));
    });
    return;
  }
  if (p === `/api/vaults/${VAULT}/notes` && req.method === 'GET') {
    const all = [...notes.values()].map(summary);
    const off = Number(u.searchParams.get('offset') || 0);
    const lim = Number(u.searchParams.get('limit') || 1000);
    return json(res, 200, { notes: all.slice(off, off + lim), limit: lim, offset: off });
  }
  const m = /^\/api\/vaults\/v1\/notes\/([^/]+)(?:\/(content|snapshot|state-vector|ws-ticket|diff))?$/.exec(p);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const n = notes.get(id);
    if (!n) return json(res, 404, { error: 'not_found' });
    if (!m[2]) return json(res, 200, summary(n));
    if (m[2] === 'content') return json(res, 200, { id, vault_id: VAULT, path: n.path, frontmatter: n.frontmatter ?? {}, body: n.body, kind: n.kind });
    if (m[2] === 'ws-ticket') {
      if (process.env.MOCK_LEGACY_TOKEN) return json(res, 404, { error: 'not_found' }); // legacy ?token= mode
      return json(res, 201, { ticket: 't' + Math.random().toString(36).slice(2), expires_at: new Date(Date.now() + 30000).toISOString(), crdt_epoch: 'e1' });
    }
    const d = docFor(id);
    if (m[2] === 'snapshot') return json(res, 200, { id, path: n.path, text: n.body, vector_clock: b64(Y.encodeStateVector(d.doc)), state: b64(Y.encodeStateAsUpdate(d.doc)), crdt_epoch: 'e1' });
    if (m[2] === 'state-vector') return json(res, 200, { id, crdt_epoch: 'e1', state_vector: b64(Y.encodeStateVector(d.doc)) });
    return json(res, 404, { error: 'not_found' });
  }
  if (p.startsWith('/api/')) {
    console.error('[mock] unhandled', req.method, p);
    return json(res, 404, { error: 'not_found' });
  }
  // static + SPA fallback
  let f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// ---- y-websocket ----------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  const m = /^\/api\/vaults\/v1\/notes\/([^/]+)\/sync$/.exec(u.pathname);
  if (!m) return socket.destroy();
  stats['WS sync'] = (stats['WS sync'] || 0) + 1;
  wss.handleUpgrade(req, socket, head, (ws) => {
    const d = docFor(decodeURIComponent(m[1]));
    ws.binaryType = 'arraybuffer';
    d.conns.add(ws);
    const send = (enc) => ws.readyState === 1 && ws.send(encoding.toUint8Array(enc));
    ws.on('message', (data) => {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const enc = encoding.createEncoder();
      const type = decoding.readVarUint(dec);
      if (type === 0) {
        encoding.writeVarUint(enc, 0);
        syncProtocol.readSyncMessage(dec, enc, d.doc, ws);
        if (encoding.length(enc) > 1) send(enc);
      } else if (type === 1) {
        awarenessProtocol.applyAwarenessUpdate(d.awareness, decoding.readVarUint8Array(dec), ws);
      }
    });
    ws.on('close', () => d.conns.delete(ws));
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeSyncStep1(enc, d.doc);
    send(enc);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[mock] http://127.0.0.1:${PORT}`));
process.on('SIGTERM', () => process.exit(0));
