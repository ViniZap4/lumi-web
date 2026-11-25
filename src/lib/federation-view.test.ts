import { describe, it, expect } from 'vitest';
import { federationRowView, publishLabel } from './federation-view.ts';
import { canTogglePublish, isPublished, publishConsentText, publishScope } from './publish.ts';
import type { Federation } from './types.ts';

const base: Federation = { id: 'f1', vault_id: 'v1', role: 'home', peer_url: 'https://m.example', status: 'active', last_acked_seq: 7, created_at: '2026-11-01T00:00:00Z' };

describe('federationRowView (M2 mirrors panel)', () => {
  it('home side of a mirror: lag, pending deletes and the erasure warning', () => {
    const v = federationRowView({ ...base, mode: 'mirror', mirror_acked_seq: 90, head_seq: 100, lag_seq: 10, pending_deletes: 2, oldest_pending_delete_at: '2026-11-20T10:00:00Z', erasure_lagging: true });
    expect(v.role).toBe('Origem');
    expect(v.mode).toBe('Espelho somente leitura');
    expect(v.status).toBe('ativo');
    expect(v.lines[0]).toBe('Atraso do espelho: 10 alterações (confirmou 90 de 100)');
    expect(v.lines[1]).toMatch(/^Exclusões pendentes: 2 \(a mais antiga desde /);
    expect(v.warning).toMatch(/mais de 24 h/);
  });

  it('home side, caught up, no warning', () => {
    const v = federationRowView({ ...base, mode: 'mirror', lag_seq: 0, pending_deletes: 0, erasure_lagging: false });
    expect(v.lines).toContain('Espelho em dia');
    expect(v.warning).toBeNull();
  });

  it('mirror side: home seq, integrity check, promotion, publish policy', () => {
    const v = federationRowView({ ...base, role: 'follower', mode: 'mirror', home_seq: 42, last_integrity_at: null, promoted: false, publish: { allowed: true, scope: 'folder:blog/', index: false } });
    expect(v.role).toBe('Espelho');
    expect(v.lines).toEqual(['Origem na alteração 42', 'Integridade ainda não verificada', 'Publicação pública: a pasta “blog/”, sem indexação']);
    expect(federationRowView({ ...base, role: 'follower', mode: 'mirror', last_integrity_at: '2026-11-24T12:00:00Z' }).lines.some((l) => l.startsWith('Última verificação de integridade: '))).toBe(true);
  });

  it('two-way replica keeps the plain replication line', () => {
    const v = federationRowView({ ...base, status: 'revoked', jurisdiction: 'BR' });
    expect(v.mode).toBe('Réplica');
    expect(v.status).toBe('revogado');
    expect(v.lines).toEqual(['Replicação: confirmou a alteração 7', 'Jurisdição: BR']);
  });

  it('publishLabel: nothing when not allowed', () => {
    expect(publishLabel(null)).toBeNull();
    expect(publishLabel({ allowed: false, scope: 'all' })).toBeNull();
    expect(publishLabel({ allowed: true, scope: 'all', index: true })).toBe('Publicação pública: todas as notas, indexável por buscadores');
  });
});

describe('publish helpers (M3)', () => {
  it('scope: folder needs a clean prefix', () => {
    expect(publishScope('flagged', '')).toBe('flagged');
    expect(publishScope('all', 'x')).toBe('all');
    expect(publishScope('folder', ' /blog ')).toBe('folder:blog/');
    expect(publishScope('folder', '')).toBeNull();
    expect(publishScope('folder', '../etc')).toBeNull();
  });

  it('consent text says public, anonymous, and about indexing', () => {
    const t = publishConsentText('flagged', false);
    expect(t).toMatch(/qualquer pessoa na internet/);
    expect(t).toMatch(/anônima/);
    expect(t).toMatch(/não as indexem/);
    expect(publishConsentText('all', true)).toMatch(/TODAS as notas/);
    expect(publishConsentText('all', true)).toMatch(/poderão indexar/);
  });

  it('toggle: markdown with note.edit only; reads the frontmatter flag', () => {
    expect(canTogglePublish({ path: 'a.md', canEdit: true })).toBe(true);
    expect(canTogglePublish({ path: 'a.canvas', canEdit: true })).toBe(false);
    expect(canTogglePublish({ path: 'a', kind: 'canvas', canEdit: true })).toBe(false);
    expect(canTogglePublish({ path: 'a.md', canEdit: false })).toBe(false);
    expect(isPublished({ publish: true })).toBe(true);
    expect(isPublished({ publish: 'yes' })).toBe(false);
  });
});
