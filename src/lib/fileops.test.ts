import { describe, it, expect } from 'vitest';
import { planCreate, planRename, planFolderRename, resolvePath, pathError, movedPath, copyTitle } from './fileops.ts';
import { noteCreateInput } from './fileops.ts';
import { EMPTY_CANVAS, serializeCanvas, parseCanvas, DEFAULT_STYLE } from './canvas/canvas.ts';

describe('resolvePath', () => {
  it('relative, absolute, dot-dot clamped', () => {
    expect(resolvePath('a/b', 'c/d')).toBe('a/b/c/d');
    expect(resolvePath('a/b', '/c')).toBe('c');
    expect(resolvePath('a/b', '../c')).toBe('a/c');
    expect(resolvePath('a', '../../../c')).toBe('c');
    expect(resolvePath('', './x//y/')).toBe('x/y');
  });
});

describe('planCreate', () => {
  it('note in the current folder', () => {
    expect(planCreate('work', 'Meeting notes')).toEqual({ kind: 'note', title: 'Meeting notes', folder: 'work' });
    expect(planCreate('', 'idea.md')).toEqual({ kind: 'note', title: 'idea', folder: '' });
  });
  it('a/b/name creates the folders on the way', () => {
    expect(planCreate('work', 'q3/plans/Roadmap')).toEqual({ kind: 'note', title: 'Roadmap', folder: 'work/q3/plans' });
    expect(planCreate('work', '/inbox/x')).toEqual({ kind: 'note', title: 'x', folder: 'inbox' });
  });
  it('trailing slash is a folder', () => {
    expect(planCreate('work', 'archive/')).toEqual({ kind: 'folder', path: 'work/archive' });
    expect(planCreate('', 'a/b/c/')).toEqual({ kind: 'folder', path: 'a/b/c' });
  });
  it('rejects dot segments, empty input and the root', () => {
    expect(planCreate('', '.secret').kind).toBe('error');
    expect(planCreate('', 'a/.lumi/x').kind).toBe('error');
    expect(planCreate('', '   ').kind).toBe('error');
    expect(planCreate('a', '../').kind).toBe('error');
    expect(pathError('a\\b')).toMatch(/backslash/);
  });
});

describe('planRename', () => {
  it('plain name retitles', () => {
    expect(planRename('work/a.md', 'A', 'Better')).toEqual({ kind: 'note', title: 'Better' });
    expect(planRename('work/a.md', 'A', 'A')).toEqual({ kind: 'none' });
  });
  it('folder/name moves relative to the note folder and retitles', () => {
    expect(planRename('work/a.md', 'A', 'done/A2')).toEqual({ kind: 'note', title: 'A2', path: 'work/done/a.md' });
    expect(planRename('work/a.md', 'A', '../A')).toEqual({ kind: 'note', path: 'a.md' });
    expect(planRename('work/a.md', 'A', '/archive/A')).toEqual({ kind: 'note', path: 'archive/a.md' });
  });
  it('dir/ moves keeping the title; name.md sets the file name', () => {
    expect(planRename('a.md', 'A', 'x/y/')).toEqual({ kind: 'note', path: 'x/y/a.md' });
    expect(planRename('w/a.md', 'A', 'b.md')).toEqual({ kind: 'note', path: 'w/b.md' });
    expect(planRename('w/a.md', 'A', 'z/b.md')).toEqual({ kind: 'note', path: 'w/z/b.md' });
  });
  it('validates', () => {
    expect(planRename('a.md', 'A', '.x/').kind).toBe('error');
    expect(planRename('a.md', 'A', '').kind).toBe('error');
  });
});

describe('folders', () => {
  it('planFolderRename: sibling rename, move, and refuses moving inside itself', () => {
    expect(planFolderRename('work/old', 'new')).toEqual({ kind: 'folder', from: 'work/old', to: 'work/new' });
    expect(planFolderRename('work/old', '/top/')).toEqual({ kind: 'folder', from: 'work/old', to: 'top' });
    expect(planFolderRename('work', 'work/inner').kind).toBe('error');
    expect(planFolderRename('work', 'work')).toEqual({ kind: 'none' });
  });
  it('movedPath rewrites only notes under the folder', () => {
    expect(movedPath('work/old/a.md', 'work/old', 'arch')).toBe('arch/a.md');
    expect(movedPath('work/older/a.md', 'work/old', 'arch')).toBeNull();
  });
  it('copyTitle avoids collisions', () => {
    expect(copyTitle('A', new Set())).toBe('A copy');
    expect(copyTitle('A', new Set(['A copy', 'A copy 2']))).toBe('A copy 3');
  });
});

describe('canvas file ops (server contract: rename = move, kind never changes)', () => {
  it('a name.canvas creates a canvas', () => {
    expect(planCreate('work', 'Plan.canvas')).toEqual({ kind: 'note', title: 'Plan', folder: 'work', noteKind: 'canvas' });
    expect(planCreate('', 'a/b/Map.canvas')).toEqual({ kind: 'note', title: 'Map', folder: 'a/b', noteKind: 'canvas' });
  });
  it('renaming a canvas is always a path move keeping .canvas', () => {
    expect(planRename('work/plan.canvas', 'plan', 'Roadmap')).toEqual({ kind: 'note', path: 'work/Roadmap.canvas' });
    expect(planRename('work/plan.canvas', 'plan', 'Roadmap.canvas')).toEqual({ kind: 'note', path: 'work/Roadmap.canvas' });
    expect(planRename('work/plan.canvas', 'plan', '../x/')).toEqual({ kind: 'note', path: 'x/plan.canvas' });
    expect(planRename('work/plan.canvas', 'plan', '/y/Z')).toEqual({ kind: 'note', path: 'y/Z.canvas' });
    expect(planRename('work/plan.canvas', 'plan', 'plan')).toEqual({ kind: 'none' });
    expect(planRename('work/plan.canvas', 'plan', 'x.md').kind).toBe('error');
  });
});

describe('new canvas body', () => {
  it('a canvas without a template sends NO body (server template applies); markdown keeps its body', () => {
    expect(noteCreateInput('map', '', 'canvas')).toEqual({ title: 'map', kind: 'canvas' });
    expect(noteCreateInput('map', '  \n', 'canvas')).toEqual({ title: 'map', kind: 'canvas' });
    expect(noteCreateInput('n', '', undefined)).toEqual({ title: 'n', body: '' });
    expect(noteCreateInput('map', EMPTY_CANVAS, 'canvas')).toEqual({ title: 'map', body: EMPTY_CANVAS, kind: 'canvas' });
  });

  it('the local empty canvas is exactly the server template, and the first commit on an empty text writes it', () => {
    expect(EMPTY_CANVAS).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
    expect(serializeCanvas({ top: {}, nodes: [], edges: [] }, DEFAULT_STYLE)).toBe(EMPTY_CANVAS);
    const p = parseCanvas(EMPTY_CANVAS);
    expect(p.ok && p.style).toEqual(DEFAULT_STYLE);
  });
});
