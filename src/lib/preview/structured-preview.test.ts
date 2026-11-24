import { describe, it, expect } from 'vitest';
import { previewKindFor, miniCanvas, miniBoard, MINI_DETAIL_LIMIT } from './structured-preview.ts';
import { noteIconKind, disambiguateTitles, NOTE_ICON_PATH } from '../note-icons.ts';

describe('preview selection', () => {
  it('picks canvas / kanban / markdown from the summary and (when known) the content', () => {
    expect(previewKindFor({ path: 'a.canvas' })).toBe('canvas');
    expect(previewKindFor({ path: 'a', kind: 'canvas' })).toBe('canvas');
    expect(previewKindFor({ path: 'a.md' })).toBe('markdown');
    expect(previewKindFor({ path: 'a.md' }, { frontmatter: { 'kanban-plugin': 'board' } })).toBe('kanban');
    expect(previewKindFor({ path: 'a.md' }, { kind: 'canvas' })).toBe('canvas');
    expect(previewKindFor(null)).toBe('markdown');
  });
});

describe('kind icons', () => {
  it('maps every kind to its own glyph', () => {
    expect(noteIconKind({ path: 'x.canvas' })).toBe('canvas');
    expect(noteIconKind({ path: 'x.md' }, { frontmatter: { 'kanban-plugin': 'basic' } })).toBe('kanban');
    expect(noteIconKind({ path: 'x.md' })).toBe('markdown');
    const paths = Object.values(NOTE_ICON_PATH);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('suffixes the kind only when different kinds share a title', () => {
    expect(
      disambiguateTitles([
        { name: 'test', kind: 'canvas' },
        { name: 'Test', kind: 'markdown' },
        { name: 'solo', kind: 'canvas' },
        { name: 'dup', kind: 'markdown' },
        { name: 'dup', kind: 'markdown' },
        { name: 'test', kind: null }, // folders keep their name
      ]),
    ).toEqual(['test · canvas', 'Test · note', 'solo', 'dup', 'dup', 'test']);
    expect(disambiguateTitles([{ name: 'b', kind: 'kanban' }, { name: 'b', kind: 'markdown' }])[0]).toBe('b · board');
  });
});

describe('mini canvas', () => {
  const doc = (nodes: unknown[], edges: unknown[] = []) => JSON.stringify({ nodes, edges });

  it('fits the bounds, keeps groups/cards/edges/colors, file nodes as titled cards', () => {
    const m = miniCanvas(
      doc(
        [
          { id: 'g', type: 'group', label: 'G', x: -100, y: -100, width: 800, height: 400, color: '4' },
          { id: 't', type: 'text', text: '# Hi', x: 0, y: 0, width: 200, height: 60, color: '#ff0000' },
          { id: 'f', type: 'file', file: 'notes/plan.md', x: 300, y: 0, width: 200, height: 100 },
          { id: 'l', type: 'link', url: 'https://example.com/x', x: 0, y: 200, width: 200, height: 60 },
        ],
        [{ id: 'e', fromNode: 't', toNode: 'f', color: '1' }],
      ),
    );
    expect(m.error).toBeNull();
    expect(m.groups.map((g) => [g.label, g.color])).toEqual([['G', 'var(--canvas-4)']]);
    expect(m.cards.map((c) => [c.type, c.label, c.text])).toEqual([
      ['text', '', '# Hi'],
      ['file', 'plan', null],
      ['link', 'example.com', null],
    ]);
    expect(m.cards[0].color).toBe('#ff0000');
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0].d).toMatch(/^M/);
    const [x, y, w, h] = m.viewBox.split(' ').map(Number);
    expect(x).toBeLessThan(-100);
    expect(y).toBeLessThan(-100);
    expect(x + w).toBeGreaterThan(700);
    expect(y + h).toBeGreaterThan(300);
  });

  it(`big canvases (> ${MINI_DETAIL_LIMIT} nodes) become plain boxes`, () => {
    const nodes = Array.from({ length: MINI_DETAIL_LIMIT + 1 }, (_, i) => ({ id: 'n' + i, type: 'text', text: 'x', x: i * 10, y: 0, width: 5, height: 5 }));
    const m = miniCanvas(doc(nodes, [{ id: 'e', fromNode: 'n0', toNode: 'n1' }]));
    expect(m.simplified).toBe(true);
    expect(m.cards.every((c) => c.text == null)).toBe(true);
    expect(m.edges).toHaveLength(0);
    expect(m.nodeCount).toBe(MINI_DETAIL_LIMIT + 1);
  });

  it('invalid and empty canvases', () => {
    expect(miniCanvas('{"nodes":[').error).toBeTruthy();
    expect(miniCanvas('{"nodes":[],"edges":[]}').nodeCount).toBe(0);
  });
});

describe('mini board', () => {
  it('columns with their first cards', () => {
    const lanes = miniBoard('## A\n\n- [ ] one [[Note|alias]]\n- [x] two\n- [ ] three\n\n## B\n\n- [ ] four\n', 2);
    expect(lanes.map((l) => [l.title, l.total])).toEqual([['A', 3], ['B', 1]]);
    expect(lanes[0].cards).toEqual([{ text: 'one alias', checked: false }, { text: 'two', checked: true }]);
  });
});
