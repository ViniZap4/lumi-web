import type { SubmitFunction } from '$app/forms';
import { say } from './flash.svelte.ts';

type Result = { ok?: boolean; message?: string } | undefined;

interface Options {
	success?: () => void;
	failure?: (message: string, data: Record<string, unknown> | undefined) => void;
	pending?: (on: boolean) => void;
	reset?: boolean;
}

/** `use:enhance` that announces the action's Portuguese message and reports a pending flag. */
export function withFlash(options: Options = {}): SubmitFunction {
	return () => {
		options.pending?.(true);
		return async ({ result, update }) => {
			options.pending?.(false);
			if (result.type === 'success') {
				const data = result.data as Result;
				if (data?.message) say(data.message, 'ok');
				options.success?.();
				await update({ reset: options.reset ?? true });
			} else if (result.type === 'failure') {
				const data = result.data as Record<string, unknown> | undefined;
				const message = typeof data?.message === 'string' ? data.message : 'Não deu certo. Tente de novo.';
				say(message, 'alert');
				options.failure?.(message, data);
				await update({ reset: false });
			} else if (result.type === 'error') {
				const message = result.error?.message || 'O painel teve um erro.';
				say(message, 'alert');
				options.failure?.(message, undefined);
			} else {
				// A redirect (e.g. to the login after a 401, or away from a deleted item).
				await update();
			}
		};
	};
}
