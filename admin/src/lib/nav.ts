import type { IconName } from './components/Icon.svelte';

export interface NavItem {
	readonly href: string;
	readonly label: string;
	/** Second key of the "g <key>" shortcut. */
	readonly key: string;
	readonly icon: IconName;
}

export interface NavSection {
	readonly title?: string;
	readonly items: readonly NavItem[];
}

export const SECTIONS: readonly NavSection[] = [
	{
		items: [{ href: '/', label: 'Visão geral', key: 'i', icon: 'home' }]
	},
	{
		title: 'Contas',
		items: [
			{ href: '/usuarios', label: 'Usuários', key: 'u', icon: 'users' },
			{ href: '/sessoes', label: 'Sessões', key: 's', icon: 'activity' }
		]
	},
	{
		title: 'Conteúdo',
		items: [
			{ href: '/cofres', label: 'Cofres', key: 'c', icon: 'vault' },
			{ href: '/convites', label: 'Convites', key: 'v', icon: 'mail' },
			{ href: '/federacoes', label: 'Federações', key: 'f', icon: 'globe' }
		]
	},
	{
		title: 'Servidor',
		items: [
			{ href: '/tokens', label: 'Tokens', key: 't', icon: 'key' },
			{ href: '/auditoria', label: 'Auditoria', key: 'a', icon: 'shield' }
		]
	}
];

export const NAV: readonly NavItem[] = SECTIONS.flatMap((s) => s.items);

/** Whether a key press belongs to a text field (shortcuts never steal typing). */
export function isTyping(target: EventTarget | null): boolean {
	if (!target || typeof (target as Element).closest !== 'function') return false;
	const el = target as HTMLElement;
	return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog[open]');
}

/**
 * "g" then a letter, within a second, like the lumi client's leader keys. Returns the href to visit, or null.
 * Stateful: feed it every keydown.
 */
export class GoShortcut {
	#armedAt = -Infinity;
	constructor(
		readonly items: readonly NavItem[] = NAV,
		readonly windowMs = 1000,
		readonly now: () => number = Date.now
	) {}

	press(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): string | null {
		if (mods.ctrl || mods.meta || mods.alt) {
			this.#armedAt = -Infinity;
			return null;
		}
		const t = this.now();
		if (t - this.#armedAt <= this.windowMs) {
			this.#armedAt = -Infinity;
			return this.items.find((i) => i.key === key.toLowerCase())?.href ?? null;
		}
		if (key === 'g') this.#armedAt = t;
		return null;
	}
}

export function isCurrent(href: string, pathname: string): boolean {
	return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
