import { describe, it, expect } from 'vitest';
import { registerStructuredViews } from './structured-views.ts';
import { viewsFor, resolveView } from './note-views.ts';
import { classifyLink } from './link-open.ts';
import type { NoteSummary } from './types.ts';

registerStructuredViews();

describe('structured views in the pane registry', () => {
  it('kanban notes default to the Board with a Note switch', () => {
    const m = { path: 'boards/q3.md', frontmatter: { 'kanban-plugin': 'board' } };
    expect(viewsFor(m).map((v) => v.label)).toEqual(['Board', 'Note']);
    expect(resolveView(m)).toBe('kanban');
    expect(resolveView(m, 'markdown')).toBe('markdown');
  });
  it('canvases (by kind or .canvas path) default to the Canvas with a Source switch', () => {
    expect(resolveView({ path: 'map.canvas' })).toBe('canvas');
    expect(resolveView({ path: 'map', kind: 'canvas' })).toBe('canvas');
    expect(viewsFor({ path: 'map.canvas' }).map((v) => v.label)).toEqual(['Canvas', 'Source']);
  });
  it('plain notes stay markdown; an unknown override falls back', () => {
    expect(viewsFor({ path: 'a.md', frontmatter: {} }).map((v) => v.id)).toEqual(['markdown']);
    expect(resolveView({ path: 'a.md' }, 'kanban')).toBe('markdown');
  });
  it('canvas file nodes and links to canvases resolve to the file (no .md appended)', () => {
    const notes: NoteSummary[] = [{ id: 'c', vault_id: 'v', path: 'maps/sites.canvas', title: 'sites', created_at: '', updated_at: '' }];
    expect(classifyLink(notes, 'boards/x.canvas', '/maps/sites.canvas')).toMatchObject({ kind: 'note', note: { id: 'c' } });
  });
});
