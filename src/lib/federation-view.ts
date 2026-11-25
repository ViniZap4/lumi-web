// pt-BR presentation of one federation link (book settings → Federação),
// pure so it is testable and portable. Mirrors (M2): lag, pending
// deletes, the erasure SLA warning, integrity checks; M3 publish policy.

import type { Federation, PublishPolicy } from './types.ts';

export interface FederationRowView {
  /** "Origem" | "Seguidor" | "Espelho" (this server's side). */
  role: string;
  /** "Réplica" | "Espelho somente leitura". */
  mode: string;
  status: string;
  lines: string[];
  /** Shown as an alert (LGPD erasure lagging). */
  warning: string | null;
}

const STATUS: Record<string, string> = { active: 'ativo', revoked: 'revogado', severed: 'cortado' };

function when(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('pt-BR');
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function publishLabel(p: PublishPolicy | null | undefined): string | null {
  if (!p?.allowed) return null;
  const scope = p.scope === 'all' ? 'todas as notas' : p.scope.startsWith('folder:') ? `a pasta “${p.scope.slice(7)}”` : 'só as notas marcadas para publicar';
  return `Publicação pública: ${scope}${p.index ? ', indexável por buscadores' : ', sem indexação'}`;
}

export function federationRowView(f: Federation): FederationRowView {
  const mirror = f.mode === 'mirror';
  const home = f.role === 'home';
  const role = home ? 'Origem' : mirror ? 'Espelho' : 'Seguidor';
  const lines: string[] = [];
  let warning: string | null = null;
  if (mirror && home) {
    const lag = f.lag_seq ?? 0;
    lines.push(
      lag > 0
        ? `Atraso do espelho: ${plural(lag, 'alteração', 'alterações')} (confirmou ${f.mirror_acked_seq ?? 0} de ${f.head_seq ?? 0})`
        : 'Espelho em dia',
    );
    const pd = f.pending_deletes ?? 0;
    if (pd > 0) {
      const since = when(f.oldest_pending_delete_at);
      lines.push(`Exclusões pendentes: ${pd}${since ? ` (a mais antiga desde ${since})` : ''}`);
    }
    if (f.erasure_lagging) {
      warning = 'O espelho não confirmou exclusões há mais de 24 h. Pedidos de apagamento (LGPD) podem estar atrasados nesse servidor.';
    }
  } else if (mirror) {
    lines.push(`Origem na alteração ${f.home_seq ?? 0}`);
    if (f.promoted) lines.push('Promovido: agora é um livro independente');
    const ia = when(f.last_integrity_at);
    lines.push(ia ? `Última verificação de integridade: ${ia}` : 'Integridade ainda não verificada');
  } else if (home) {
    lines.push(`Replicação: confirmou a alteração ${f.last_acked_seq}`);
  }
  const pub = publishLabel(f.publish);
  if (pub) lines.push(pub);
  if (f.paused) lines.push('Pausado');
  const contact = when(f.last_contact_at);
  if (contact) lines.push(`Último contato: ${contact}`);
  if (f.jurisdiction) lines.push(`Jurisdição: ${f.jurisdiction}`);
  return { role, mode: mirror ? 'Espelho somente leitura' : 'Réplica', status: STATUS[f.status] ?? f.status, lines, warning };
}
