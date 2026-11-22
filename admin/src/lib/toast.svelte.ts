export type Tone = 'ok' | 'alert' | 'warn' | 'info';

export interface Toast {
	readonly id: number;
	readonly message: string;
	readonly tone: Tone;
}

/** The action messages on screen, read by the Toaster in the panel layout (a polite live region). */
export const toasts = $state<{ list: Toast[] }>({ list: [] });

let seq = 0;
const MAX = 4;

export function toast(message: string, tone: Tone = 'ok', ttlMs = tone === 'alert' ? 9000 : 5000): number {
	const id = ++seq;
	toasts.list = [...toasts.list, { id, message, tone }].slice(-MAX);
	if (ttlMs > 0 && typeof setTimeout === 'function') setTimeout(() => dismiss(id), ttlMs);
	return id;
}

export function dismiss(id: number): void {
	toasts.list = toasts.list.filter((t) => t.id !== id);
}
