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

/** "3 d 4 h", "5 h 12 min", "8 min": the two largest units of a duration. */
export function formatDuration(msecs: number): string {
	const m = Math.max(0, Math.floor(msecs / 60_000));
	const d = Math.floor(m / 1440);
	const h = Math.floor((m % 1440) / 60);
	const min = m % 60;
	if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
	if (h > 0) return min > 0 ? `${h} h ${min} min` : `${h} h`;
	return `${min} min`;
}

export function formatMs(ms: number): string {
	return ms < 10 ? `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(ms)} ms` : `${formatInt(Math.round(ms))} ms`;
}

export function plural(n: number, one: string, many: string): string {
	return `${formatInt(n)} ${n === 1 ? one : many}`;
}
