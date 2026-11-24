// Pure helpers for ```mermaid fenced blocks: which kind of diagram a
// source declares and what to call it (aria-label, header, badge).
// No DOM, no mermaid import: markdown.ts and the Live Preview builder
// use these on every render, so they must stay cheap.

/** Fence info strings that mean "mermaid diagram". */
export function isMermaidLang(lang: string | null | undefined): boolean {
  return (lang ?? '').trim().split(/\s+/)[0].toLowerCase() === 'mermaid';
}

/** Diagram keyword (first word of the first statement) → short kind. */
const KINDS: Record<string, string> = {
  graph: 'flowchart',
  flowchart: 'flowchart',
  'flowchart-elk': 'flowchart',
  sequencediagram: 'sequence',
  classdiagram: 'class',
  'classdiagram-v2': 'class',
  statediagram: 'state',
  'statediagram-v2': 'state',
  erdiagram: 'er',
  gantt: 'gantt',
  pie: 'pie',
  mindmap: 'mindmap',
  journey: 'journey',
  gitgraph: 'git',
  timeline: 'timeline',
  quadrantchart: 'quadrant',
  requirementdiagram: 'requirement',
  c4context: 'c4',
  c4container: 'c4',
  c4component: 'c4',
  c4dynamic: 'c4',
  c4deployment: 'c4',
  sankey: 'sankey',
  'sankey-beta': 'sankey',
  xychart: 'xychart',
  'xychart-beta': 'xychart',
  block: 'block',
  'block-beta': 'block',
  packet: 'packet',
  'packet-beta': 'packet',
  architecture: 'architecture',
  'architecture-beta': 'architecture',
  kanban: 'kanban',
  radar: 'radar',
  'radar-beta': 'radar',
  treemap: 'treemap',
  'treemap-beta': 'treemap',
  zenuml: 'zenuml',
  venn: 'venn',
  'venn-beta': 'venn',
};

/** Human names for the aria-label ("Sequence diagram: …"). */
const KIND_NAMES: Record<string, string> = {
  flowchart: 'Flowchart',
  sequence: 'Sequence diagram',
  class: 'Class diagram',
  state: 'State diagram',
  er: 'Entity relationship diagram',
  gantt: 'Gantt chart',
  pie: 'Pie chart',
  mindmap: 'Mind map',
  journey: 'User journey',
  git: 'Git graph',
  timeline: 'Timeline',
  quadrant: 'Quadrant chart',
  requirement: 'Requirement diagram',
  c4: 'C4 diagram',
  sankey: 'Sankey diagram',
  xychart: 'XY chart',
  block: 'Block diagram',
  packet: 'Packet diagram',
  architecture: 'Architecture diagram',
  kanban: 'Kanban diagram',
  radar: 'Radar chart',
  treemap: 'Treemap',
  zenuml: 'ZenUML diagram',
  venn: 'Venn diagram',
};

export interface MermaidInfo {
  /** Short kind (`flowchart`, `sequence`, …) or `diagram` when unknown. */
  kind: string;
  /** Title from front matter, `accTitle:` or a `title` statement. */
  title: string | null;
  /** First statement after the diagram keyword line, if any. */
  firstLine: string | null;
}

/** Statements of a source: front matter, `%%` comments/directives and
 *  blank lines removed. Front matter is returned separately. */
function statements(src: string): { front: string[]; lines: string[] } {
  const all = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < all.length && all[i].trim() === '') i++;
  const front: string[] = [];
  if (all[i]?.trim() === '---') {
    let j = i + 1;
    while (j < all.length && all[j].trim() !== '---') j++;
    if (j < all.length) {
      front.push(...all.slice(i + 1, j));
      i = j + 1;
    }
  }
  const lines: string[] = [];
  for (; i < all.length; i++) {
    const t = all[i].trim();
    if (!t || t.startsWith('%%')) continue;
    lines.push(t);
  }
  return { front, lines };
}

function clip(s: string, n = 80): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function unquote(s: string): string {
  return s.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

/** Kind, title and first statement of a mermaid source. */
export function mermaidInfo(src: string): MermaidInfo {
  const { front, lines } = statements(src);
  const head = lines[0] ?? '';
  const word = head.split(/[\s:;{]/)[0].toLowerCase();
  const kind = KINDS[word] ?? 'diagram';

  let title: string | null = null;
  for (const f of front) {
    const m = /^title\s*:\s*(.+)$/.exec(f.trim());
    if (m) {
      title = unquote(m[1]);
      break;
    }
  }
  if (!title) {
    for (const l of lines) {
      const m = /^accTitle\s*:\s*(.+)$/.exec(l);
      if (m) {
        title = m[1].trim();
        break;
      }
    }
  }
  if (!title) {
    // `pie title X`, or a `title X` statement (gantt, journey, timeline…).
    const inline = /^\S+(?:\s+showData)?\s+title\s+(.+)$/i.exec(head);
    if (inline) title = unquote(inline[1]);
    else {
      const stmt = lines.slice(1).find((l) => /^title\s+\S/i.test(l));
      if (stmt) title = unquote(stmt.replace(/^title\s+/i, ''));
    }
  }
  const rest = lines.slice(1).find((l) => !/^(title|accTitle|accDescr|autonumber|direction|dateFormat|axisFormat|tickInterval|excludes|showData)\b/i.test(l));
  return { kind, title: title ? clip(title) : null, firstLine: rest ? clip(rest, 60) : null };
}

/** Short kind only (`flowchart`, `sequence`, … or `diagram`). */
export function mermaidKind(src: string): string {
  return mermaidInfo(src).kind;
}

/** Accessible name: the title, else the kind plus its first statement. */
export function mermaidLabel(src: string): string {
  const info = mermaidInfo(src);
  const name = KIND_NAMES[info.kind] ?? 'Mermaid diagram';
  if (info.title) return `${name}: ${info.title}`;
  return info.firstLine ? `${name}: ${info.firstLine}` : name;
}
