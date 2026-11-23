import { describe, it, expect } from 'vitest';
import { planCreate, planRename, planFolderRename, resolvePath, pathError, movedPath, copyTitle } from './fileops.ts';

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
