// @vitest-environment jsdom
//
// LFM 1.0 conformance (docs/SPEC-LFM.md §7): every vector in the shared
// lumi-spec repo (vectors/lfm/*.json) is rendered by lib/markdown.ts,
// mapped onto the normalised render tree by test/lfm-adapter.ts and
// compared with the pinned tree.
//
// Vectors come from the `spec/` submodule of this repo (lumi-spec), or
// else from the umbrella checkout's `spec/` next to `web-client/`.
// Without either the suite is skipped, unless LUMI_SPEC_REQUIRED=1.
//
// XFAIL lists vectors that pin an intended change the web renderer has
// not made yet. They run as `it.fails`, so fixing one turns the suite
// red until its entry is deleted here.

import { describe, it, expect } from 'vitest';
import { webRenderTree } from '../test/lfm-adapter.ts';

const WIKI = 'the reader does not render wikilinks/embeds yet; it prints [[…]] literally (SPEC-LFM §3.7)';
const XFAIL: Record<string, string> = {
  'task-empty': 'marked needs content after "[ ]", but taskMarkers() still counts the marker, so toggles drift by one (SPEC-LFM §3.4)',
  'mark-triple': 'the ==mark== tokenizer lets the closing character be "=" (SPEC-LFM §3.5)',
  'wiki-basic': WIKI,
  'wiki-alias': WIKI,
  'wiki-heading': WIKI,
  'wiki-heading-alias': WIKI,
  'wiki-folder': WIKI,
  'wiki-md-ext': WIKI,
  'wiki-trim': WIKI,
  'wiki-nonbmp': WIKI,
  'wiki-two': WIKI,
  'wiki-in-field': WIKI,
  'embed-note': WIKI,
  'embed-note-heading': WIKI,
  'embed-image': WIKI,
  'embed-image-alias': WIKI,
  'embed-inline': WIKI,
  'edge-tag-in-wikilink-alias': WIKI,
  'tag-leading-digit': 'the tag rule requires a letter or "_" first; LFM allows digits when a non-digit follows (SPEC-LFM §3.8)',
  'tag-intraword': 'the tag tokenizer has no left-boundary check when a text token ends right before "#" (SPEC-LFM §3.8)',
  'tag-in-link': 'the tag extension also runs inside link text (SPEC-LFM §3.8)',
  'inl-math': 'no $…$ inline math on the web (SPEC-LFM §3.10)',
  'inl-math-display': 'no $$…$$ display math on the web (SPEC-LFM §3.10)',
  'emb-youtube-in-fence': 'liftMediaEmbeds rewrites YouTube/Vimeo image lines before lexing, even inside fenced code (SPEC-LFM §3.11)',
  'norm-bom-heading': 'a leading U+FEFF is not stripped (SPEC-LFM §2)',
  'norm-bom-frontmatter': 'a leading U+FEFF is not stripped, so the frontmatter is missed (SPEC-LFM §2)',
  'fm-dots': 'stripFrontmatter accepts "..." as the closing fence; the server does not (SPEC-LFM §2.2)',
  'fm-empty': 'stripFrontmatter needs a line between the fences (SPEC-LFM §2.2)',
  'edge-image-alt-formatting': 'marked keeps the raw markdown in alt instead of its plain text (SPEC-LFM §3.11)',
};

interface Vector {
  id: string;
  desc: string;
  md: string;
  tree: unknown;
}
interface VectorFile {
  suite: string;
  cases: Vector[];
}

const fromSubmodule = import.meta.glob('/spec/vectors/lfm/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const fromUmbrella = import.meta.glob('../../../spec/vectors/lfm/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/** File name → parsed JSON, from the first location that has vectors. */
function vectorFiles(): Record<string, unknown> | null {
  for (const found of [fromSubmodule, fromUmbrella]) {
    const byName: Record<string, unknown> = {};
    for (const [path, data] of Object.entries(found)) byName[path.slice(path.lastIndexOf('/') + 1)] = data;
    if (byName['render-tree.schema.json']) return byName;
  }
  return null;
}

// ── minimal JSON Schema (2020-12 subset used by the LFM schemas) ───────

type Schema = Record<string, unknown>;

function validator(files: Record<string, unknown>) {
  const load = (file: string): Schema => files[file] as Schema;

  function resolveRef(ref: string, base: string): [Schema, string] {
    const [file, frag] = ref.split('#');
    const doc = file ? file : base;
    let node: unknown = load(doc);
    for (const part of (frag ?? '').split('/').filter(Boolean)) node = (node as Schema)[part];
    return [node as Schema, doc];
  }

  function typeOf(v: unknown): string {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    return typeof v;
  }

  function errors(s: Schema, v: unknown, base: string, path: string): string[] {
    const out: string[] = [];
    if (s.$ref) {
      const [target, doc] = resolveRef(String(s.$ref), base);
      out.push(...errors(target, v, doc, path));
    }
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      const t = typeOf(v);
      if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return [`${path}: type ${t}, want ${types.join('|')}`];
    }
    if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(v)) out.push(`${path}: want ${JSON.stringify(s.const)}`);
    if (s.enum && !(s.enum as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(v))) out.push(`${path}: ${JSON.stringify(v)} not in enum`);
    if (typeof v === 'string') {
      if (s.minLength != null && [...v].length < Number(s.minLength)) out.push(`${path}: shorter than ${s.minLength}`);
      if (s.pattern && !new RegExp(String(s.pattern), 'u').test(v)) out.push(`${path}: does not match ${s.pattern}`);
    }
    if (typeof v === 'number') {
      if (s.minimum != null && v < Number(s.minimum)) out.push(`${path}: < ${s.minimum}`);
      if (s.maximum != null && v > Number(s.maximum)) out.push(`${path}: > ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < Number(s.minItems)) out.push(`${path}: fewer than ${s.minItems} items`);
      if (s.items) v.forEach((x, i) => out.push(...errors(s.items as Schema, x, base, `${path}[${i}]`)));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      for (const r of (s.required as string[]) ?? []) if (!(r in o)) out.push(`${path}: missing ${r}`);
      const props = (s.properties as Record<string, Schema>) ?? {};
      for (const [k, x] of Object.entries(o)) {
        if (props[k]) out.push(...errors(props[k], x, base, `${path}.${k}`));
        else if (s.additionalProperties === false) out.push(`${path}: unexpected ${k}`);
      }
    }
    if (s.allOf) for (const sub of s.allOf as Schema[]) out.push(...errors(sub, v, base, path));
    if (s.oneOf) {
      const ok = (s.oneOf as Schema[]).filter((sub) => errors(sub, v, base, path).length === 0).length;
      if (ok !== 1) out.push(`${path}: matches ${ok} of oneOf (want 1): ${JSON.stringify(v).slice(0, 120)}`);
    }
    if (s.not && errors(s.not as Schema, v, base, path).length === 0) out.push(`${path}: matches "not"`);
    if (s.if) {
      const pass = errors(s.if as Schema, v, base, path).length === 0;
      const branch = (pass ? s.then : s.else) as Schema | undefined;
      if (branch) out.push(...errors(branch, v, base, path));
    }
    return out;
  }

  return (file: string, v: unknown) => errors(load(file), v, file, '$');
}

// ── suite ──────────────────────────────────────────────────────────────

const files = vectorFiles();
if (!files && import.meta.env.LUMI_SPEC_REQUIRED === '1') throw new Error('LFM vectors not found (spec/ submodule missing)');

describe.skipIf(!files)('LFM 1.0 render-tree vectors (web)', () => {
  const loaded = Object.keys(files ?? {})
    .filter((f) => !f.endsWith('.schema.json'))
    .sort()
    .map((f) => ({ file: f, data: files![f] as VectorFile }));
  const all = loaded.flatMap((l) => l.data.cases);

  it('the vector files match vectors.schema.json and ids are unique', () => {
    const validate = validator(files!);
    for (const l of loaded) expect(validate('vectors.schema.json', l.data), l.file).toEqual([]);
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.length).toBeGreaterThanOrEqual(150);
  });

  it('every XFAIL entry names an existing vector', () => {
    const ids = new Set(all.map((c) => c.id));
    expect(Object.keys(XFAIL).filter((id) => !ids.has(id))).toEqual([]);
  });

  for (const { data } of loaded) {
    describe(data.suite, () => {
      for (const v of data.cases) {
        const run = () => expect(webRenderTree(v.md)).toEqual(v.tree);
        if (XFAIL[v.id]) it.fails(`${v.id} — XFAIL: ${XFAIL[v.id]}`, run);
        else it(`${v.id}: ${v.desc}`, run);
      }
    });
  }
});
