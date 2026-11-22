const LOCALE = 'pt-BR';

const dateTime = new Intl.DateTimeFormat(LOCALE, {
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});
const dateOnly = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
const integer = new Intl.NumberFormat(LOCALE);

function ms(iso: string | null): number | null {
	if (iso === null) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : t;
}

export function formatDateTime(iso: string | null): string {
	const t = ms(iso);
	return t === null ? '—' : dateTime.format(t);
}

export function formatDate(iso: string | null): string {
	const t = ms(iso);
	return t === null ? '—' : dateOnly.format(t);
}

export function formatInt(n: number): string {
	return integer.format(n);
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	const digits = unit === 0 || value >= 100 ? 0 : 1;
	return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 24 * 3600_000],
	['month', 30 * 24 * 3600_000],
	['day', 24 * 3600_000],
	['hour', 3600_000],
	['minute', 60_000]
];

export function formatRelative(iso: string | null, now = Date.now()): string {
	const t = ms(iso);
	if (t === null) return 'nunca';
	const diff = t - now;
	for (const [unit, size] of STEPS) {
		if (Math.abs(diff) >= size) return relative.format(Math.round(diff / size), unit);
	}
	return 'agora';
}

export function daysUntil(iso: string, now = Date.now()): number {
	const t = ms(iso);
	return t === null ? 0 : Math.floor((t - now) / (24 * 3600_000));
}

export function shortId(id: string): string {
	return id.slice(0, 8);
}

const actions: Record<string, string> = {
	'admin.token.create': 'Token de admin criado (terminal)',
	'admin.token.revoke': 'Token de admin revogado',
	'admin.user.create': 'Usuário criado pelo admin',
	'admin.user.password': 'Senha redefinida pelo admin',
	'admin.user.disable': 'Usuário desativado',
	'admin.user.enable': 'Usuário reativado',
	'admin.user.unlock': 'Usuário desbloqueado',
	'admin.user.delete': 'Usuário apagado pelo admin',
	'admin.session.revoke': 'Sessão encerrada pelo admin',
	'admin.vault.delete': 'Cofre apagado pelo admin',
	'admin.federation.revoke': 'Federação revogada pelo admin',
	'user.delete': 'Usuário apagado',
	'vault.delete': 'Cofre apagado',
	'federation.revoke': 'Federação revogada'
};

/** A Portuguese label for the known audit actions; unknown ones show as they come. */
export function actionLabel(action: string): string {
	return actions[action] ?? action;
}
