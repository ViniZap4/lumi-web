import { type AuditEntry, isAuditAction, isUUID } from './admin.ts';

/** Portuguese labels for the actions lumi-server writes (domain.Action*, admin.Action*). Unknown ones show raw. */
const LABELS: Record<string, string> = {
	'admin.token.create': 'Token de admin criado (terminal)',
	'admin.token.revoke': 'Token de admin revogado',
	'admin.user.create': 'Usuário criado pelo admin',
	'admin.user.password': 'Senha redefinida pelo admin',
	'admin.user.disable': 'Usuário desativado',
	'admin.user.enable': 'Usuário reativado',
	'admin.user.unlock': 'Usuário desbloqueado',
	'admin.user.logout': 'Sessões do usuário encerradas pelo admin',
	'admin.user.delete': 'Usuário apagado pelo admin',
	'admin.session.revoke': 'Sessão encerrada pelo admin',
	'admin.vault.delete': 'Cofre apagado pelo admin',
	'admin.invite.revoke': 'Convite revogado pelo admin',
	'admin.federation.revoke': 'Federação revogada pelo admin',
	'auth.register': 'Cadastro',
	'auth.login': 'Entrada',
	'auth.login_failed': 'Falha de login',
	'auth.logout': 'Saída',
	'auth.password_change': 'Senha trocada pelo usuário',
	'user.update': 'Perfil atualizado',
	'user.delete': 'Conta apagada',
	'user.export_request': 'Exportação de dados pedida',
	'consent.accept': 'Termos aceitos',
	'consent.update': 'Consentimento atualizado',
	'vault.create': 'Cofre criado',
	'vault.update': 'Cofre atualizado',
	'vault.delete': 'Cofre apagado',
	'vault.transfer': 'Cofre transferido',
	'vault.export': 'Cofre exportado',
	'vault.copy': 'Cofre copiado',
	'vault.federate': 'Cofre federado',
	'member.add': 'Membro adicionado',
	'member.remove': 'Membro removido',
	'member.role_change': 'Papel de membro trocado',
	'member.invite': 'Membro convidado',
	'role.create': 'Papel criado',
	'role.update': 'Papel alterado',
	'role.delete': 'Papel apagado',
	'invite.create': 'Convite criado',
	'invite.accept': 'Convite aceito',
	'invite.revoke': 'Convite revogado',
	'note.create': 'Nota criada',
	'note.delete': 'Nota apagada',
	'note.move': 'Nota movida',
	'federation.invite': 'Convite de federação',
	'federation.accept': 'Federação aceita',
	'federation.revoke': 'Federação revogada'
};

export function actionLabel(action: string): string {
	return LABELS[action] ?? action;
}

export type ActionTone = 'admin' | 'alert' | 'auth' | 'neutral';

export function actionTone(action: string): ActionTone {
	if (action === 'auth.login_failed') return 'alert';
	if (action.startsWith('admin.')) return 'admin';
	if (action.startsWith('auth.')) return 'auth';
	if (action.endsWith('.delete') || action.endsWith('.revoke')) return 'alert';
	return 'neutral';
}

/** The action filter of the audit page: groups (prefix.*) and the exact actions an operator looks for most. */
export const ACTION_FILTERS: readonly { value: string; label: string }[] = [
	{ value: '', label: 'Todas as ações' },
	{ value: 'admin.*', label: 'Administração' },
	{ value: 'auth.login_failed', label: 'Falhas de login' },
	{ value: 'auth.login', label: 'Entradas' },
	{ value: 'auth.*', label: 'Autenticação (tudo)' },
	{ value: 'user.*', label: 'Contas' },
	{ value: 'consent.*', label: 'Consentimentos' },
	{ value: 'vault.*', label: 'Cofres' },
	{ value: 'member.*', label: 'Membros' },
	{ value: 'role.*', label: 'Papéis' },
	{ value: 'invite.*', label: 'Convites' },
	{ value: 'note.*', label: 'Notas' },
	{ value: 'federation.*', label: 'Federação' }
];

function payloadOf(e: Pick<AuditEntry, 'payload'>): Record<string, unknown> {
	return typeof e.payload === 'object' && e.payload !== null && !Array.isArray(e.payload)
		? (e.payload as Record<string, unknown>)
		: {};
}

/** Who did it: the admin token's name for admin.* rows, else the username the row carries (if any). */
export function actorOf(e: Pick<AuditEntry, 'action' | 'payload'>): string {
	const p = payloadOf(e);
	if (e.action.startsWith('admin.')) {
		return typeof p.token_name === 'string' ? `admin · ${p.token_name}` : 'admin';
	}
	return '';
}

/** A short human target from the payload: a username, a slug, a peer. */
export function targetOf(e: Pick<AuditEntry, 'payload'>): string {
	const p = payloadOf(e);
	for (const k of ['username', 'slug', 'vault_slug', 'target_token_name', 'peer_url']) {
		if (typeof p[k] === 'string' && p[k]) return p[k] as string;
	}
	return '';
}

// ---- filters -----------------------------------------------------------------------

/** Brasília time has had no daylight saving since 2019: a day in the filter is a day at -03:00. */
const OFFSET = '-03:00';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(raw: string): boolean {
	if (!DAY.test(raw)) return false;
	const t = Date.parse(`${raw}T00:00:00${OFFSET}`);
	return !Number.isNaN(t) && new Date(t + 3 * 3600_000).toISOString().slice(0, 10) === raw;
}

function nextDay(raw: string): string {
	const t = Date.parse(`${raw}T00:00:00Z`) + 24 * 3600_000;
	return new Date(t).toISOString().slice(0, 10);
}

export interface AuditFilters {
	scope: 'all' | 'admin';
	/** A user id, or a username still to be resolved. */
	user: string;
	/** A vault id, or a slug still to be resolved. */
	vault: string;
	action: string;
	from: string;
	to: string;
}

export interface ParsedAuditFilters extends AuditFilters {
	before?: number;
	since?: string;
	until?: string;
	invalid: string[];
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The filters from the query string; anything malformed is dropped and named, so a bad link still shows the log. */
export function filtersOf(url: URL): ParsedAuditFilters {
	const invalid: string[] = [];
	const q = url.searchParams;
	const scope = q.get('escopo') === 'admin' ? 'admin' : 'all';
	const ref = (name: string) => {
		const raw = (q.get(name) ?? '').trim().toLowerCase();
		if (raw === '') return '';
		if (isUUID(raw) || NAME.test(raw)) return raw;
		invalid.push(name);
		return '';
	};
	const user = ref('usuario');
	const vault = ref('cofre');
	let action = (q.get('acao') ?? '').trim();
	if (action && !isAuditAction(action)) {
		invalid.push('acao');
		action = '';
	}
	const day = (name: string) => {
		const raw = (q.get(name) ?? '').trim();
		if (raw === '') return '';
		if (validDay(raw)) return raw;
		invalid.push(name);
		return '';
	};
	let from = day('de');
	let to = day('ate');
	if (from && to && to < from) {
		invalid.push('ate');
		to = '';
	}
	const n = Number(q.get('antes'));
	const before = Number.isSafeInteger(n) && n > 0 ? n : undefined;
	return {
		scope,
		user,
		vault,
		action,
		from,
		to,
		before,
		since: from ? `${from}T00:00:00${OFFSET}` : undefined,
		until: to ? `${nextDay(to)}T00:00:00${OFFSET}` : undefined,
		invalid
	};
}

/** The query string of the current filters (no cursor), for the export link and the pager. */
export function filterQuery(f: AuditFilters): string {
	const q = new URLSearchParams();
	if (f.scope === 'admin') q.set('escopo', 'admin');
	if (f.user) q.set('usuario', f.user);
	if (f.vault) q.set('cofre', f.vault);
	if (f.action) q.set('acao', f.action);
	if (f.from) q.set('de', f.from);
	if (f.to) q.set('ate', f.to);
	return q.toString();
}

export const INVALID_LABELS: Record<string, string> = {
	usuario: 'usuário',
	cofre: 'cofre',
	acao: 'ação',
	de: 'data inicial',
	ate: 'data final'
};

// ---- CSV ---------------------------------------------------------------------------

/**
 * One CSV cell. Quotes always; a value a spreadsheet would run as a formula (=, +, -, @, tab, CR) gets a leading
 * apostrophe, so an attacker-chosen username or user agent can't become a formula on the operator's machine.
 */
export function csvCell(value: string | number | null | undefined): string {
	let s = value === null || value === undefined ? '' : String(value);
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return `"${s.replace(/"/g, '""')}"`;
}

export const CSV_HEADER = ['id', 'created_at', 'action', 'label', 'user_id', 'vault_id', 'ip', 'user_agent', 'payload'];

export function csvRow(e: AuditEntry): string {
	return [
		e.id,
		e.createdAt,
		e.action,
		actionLabel(e.action),
		e.userId,
		e.vaultId,
		e.ip,
		e.userAgent,
		e.payload === null ? '' : JSON.stringify(e.payload)
	]
		.map(csvCell)
		.join(',');
}
