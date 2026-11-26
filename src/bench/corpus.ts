// Deterministic benchmark corpora (docs/PERF-BUDGETS.md, "Corpora").
//
// Generated, not committed: the same seed always yields the same bytes,
// so baselines stay comparable across machines without checking in
// megabytes of fixtures. The recipe is small on purpose so the Go
// (server, TUI) and Swift (Mac) harnesses can follow it:
//   - mulberry32 PRNG; seeds 0x101 `prose`, 0x202 `dense`, 0x303 kanban, 0x404 canvas;
//   - words from a fixed pt-BR/English list;
//   - `prose`: real-note shape, one top-level block per ~400 B
//     (headings, paragraphs, lists, tasks, quotes, callouts, code,
//     tables, wikilinks, footnotes);
//   - `dense`: worst case for block counts, one block per ~130 B
//     (heading, paragraph, two tasks and a callout, repeated).
// Sizes are in bytes of UTF-8-ish ASCII text; the generator stops at
// the first block boundary at or past the requested size.

export const KB = 1024;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'nota livro papel respira lumi sync editor vim canvas kanban sprint tarefa ideia projeto rascunho ' +
  'the quick brown fox jumps over lazy dog paper breathes local first markdown frontmatter yjs crdt ' +
  'servidor cliente espelho selado tempo leitura escrita fluxo foco calma luz sombra margem linha ' +
  'render preview split pane explorer palette legend motion spring frame budget gate bench corpus'
).split(' ');

function words(r: () => number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(r() * WORDS.length)]);
  return out.join(' ');
}
function sentence(r: () => number): string {
  const s = words(r, 6 + Math.floor(r() * 12));
  return s[0].toUpperCase() + s.slice(1) + '.';
}
function inline(r: () => number): string {
  const s = sentence(r);
  const k = r();
  if (k < 0.15) return s.replace(/ (\w+) /, ' **$1** ');
  if (k < 0.25) return s.replace(/ (\w+) /, ' *$1* ');
  if (k < 0.35) return s.replace(/ (\w+) /, ' `$1` ');
  if (k < 0.45) return s.replace(/ (\w+) /, ' [[$1]] ');
  if (k < 0.5) return s.replace(/ (\w+) /, ' [$1](https://example.com/$1) ');
  if (k < 0.55) return s.replace(/ (\w+) /, ' ==$1== ');
  return s;
}

function proseBlock(r: () => number, i: number): string {
  const k = r();
  if (i % 9 === 0) return `${'#'.repeat(1 + Math.floor(r() * 3))} ${words(r, 3 + Math.floor(r() * 4))}`;
  if (k < 0.45) {
    const n = 2 + Math.floor(r() * 4);
    return Array.from({ length: n }, () => inline(r)).join(' ');
  }
  if (k < 0.58) return Array.from({ length: 3 + Math.floor(r() * 4) }, () => `- ${inline(r)}`).join('\n');
  if (k < 0.68) return Array.from({ length: 2 + Math.floor(r() * 4) }, () => `- [${r() < 0.4 ? 'x' : ' '}] ${words(r, 4 + Math.floor(r() * 6))}`).join('\n');
  if (k < 0.74) return `> ${inline(r)}\n> ${inline(r)}`;
  if (k < 0.8) return `> [!note] ${words(r, 3)}\n> ${inline(r)}\n> ${inline(r)}`;
  if (k < 0.87) return '```go\n' + Array.from({ length: 3 + Math.floor(r() * 6) }, () => `\t${words(r, 3)}()`).join('\n') + '\n```';
  if (k < 0.93) {
    const row = () => `| ${words(r, 1)} | ${words(r, 2)} | ${Math.floor(r() * 1000)} |`;
    return ['| a | b | c |', '|---|---|---|', row(), row(), row()].join('\n');
  }
  return `${inline(r)}[^${i}]\n\n[^${i}]: ${sentence(r)}`;
}

function denseBlock(r: () => number, i: number): string {
  return [
    `## ${words(r, 2)} ${i}`,
    words(r, 4) + '.',
    `- [ ] ${words(r, 3)}`,
    `- [x] ${words(r, 3)}`,
    '',
    `> [!tip] ${words(r, 2)}`,
  ].join('\n');
}

export type CorpusKind = 'prose' | 'dense';

const cache = new Map<string, string>();

/** A deterministic markdown note of about `bytes` bytes. */
export function corpus(kind: CorpusKind, bytes: number): string {
  const key = `${kind}:${bytes}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const r = mulberry32(kind === 'prose' ? 0x101 : 0x202);
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    const b = kind === 'prose' ? proseBlock(r, i) : denseBlock(r, i);
    parts.push(b);
    size += b.length + 2;
  }
  const out = parts.join('\n\n') + '\n';
  cache.set(key, out);
  return out;
}

/** An Obsidian Kanban board with `lanes` x `perLane` cards. */
export function kanbanCorpus(lanes: number, perLane: number): string {
  const r = mulberry32(0x303);
  const out = ['---', '', 'kanban-plugin: board', '', '---', ''];
  for (let l = 0; l < lanes; l++) {
    out.push(`## ${words(r, 2)} ${l}`, '');
    for (let c = 0; c < perLane; c++) {
      const due = r() < 0.3 ? ` @{2026-12-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}}` : '';
      out.push(`- [${r() < 0.2 ? 'x' : ' '}] ${words(r, 3 + Math.floor(r() * 5))}${due}`);
      if (r() < 0.15) out.push(`\t${sentence(r)}`);
    }
    out.push('');
  }
  out.push('', '%% kanban:settings', '```', '{"kanban-plugin":"board"}', '```', '%%', '');
  return out.join('\n');
}

/** A JSON Canvas 1.0 document in the multi-line Obsidian layout. */
export function canvasCorpus(nodes: number, edges: number): string {
  const r = mulberry32(0x404);
  const ns: string[] = [];
  for (let i = 0; i < nodes; i++) {
    const x = Math.floor(r() * 20000) - 10000;
    const y = Math.floor(r() * 20000) - 10000;
    const text = JSON.stringify(`## ${words(r, 2)}\n\n${sentence(r)}`);
    ns.push(`\t\t{"id":"n${i.toString(16).padStart(16, '0')}","type":"text","text":${text},"x":${x},"y":${y},"width":250,"height":${60 + Math.floor(r() * 200)}}`);
  }
  const es: string[] = [];
  for (let i = 0; i < edges; i++) {
    const a = Math.floor(r() * nodes);
    const b = Math.floor(r() * nodes);
    es.push(`\t\t{"id":"e${i.toString(16).padStart(16, '0')}","fromNode":"n${a.toString(16).padStart(16, '0')}","fromSide":"right","toNode":"n${b.toString(16).padStart(16, '0')}","toSide":"left"}`);
  }
  return `{\n\t"nodes":[\n${ns.join(',\n')}\n\t],\n\t"edges":[\n${es.join(',\n')}\n\t]\n}`;
}
