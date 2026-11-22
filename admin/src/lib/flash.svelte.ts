export type Tone = 'ok' | 'alert';

/** The last action's message, read by the live region in the panel layout. */
export const flash = $state<{ message: string; tone: Tone; seq: number }>({ message: '', tone: 'ok', seq: 0 });

export function say(message: string, tone: Tone = 'ok'): void {
	flash.message = message;
	flash.tone = tone;
	flash.seq++;
}

export function clearFlash(): void {
	flash.message = '';
}
