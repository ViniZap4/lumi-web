import type { SubmitFunction } from '$app/forms';
import { toast } from './toast.svelte.ts';

type Result = { ok?: boolean; message?: string } | undefined;

interface Options {
	success?: (data: Record<string, unknown> | undefined) => void;
	failure?: (message: string, data: Record<string, unknown> | undefined) => void;
	pending?: (on: boolean) => void;
	reset?: boolean;
	/** Skip the toast on success (the caller shows the result itself). */
	quiet?: boolean;
}

/** `use:enhance` that toasts the action's Portuguese message and reports a pending flag. */
export function withToast(options: Options = {}): SubmitFunction {
	return () => {
		options.pending?.(true);
		return async ({ result, update }) => {
			options.pending?.(false);
			if (result.type === 'success') {
				const data = result.data as Result & Record<string, unknown>;
				if (data?.message && !options.quiet) toast(data.message, 'ok');
				options.success?.(data);
				await update({ reset: options.reset ?? true });
			} else if (result.type === 'failure') {
				const data = result.data as Record<string, unknown> | undefined;
				const message = typeof data?.message === 'string' ? data.message : 'Não deu certo. Tente de novo.';
				toast(message, 'alert');
				options.failure?.(message, data);
				await update({ reset: false });
			} else if (result.type === 'error') {
				const message = result.error?.message || 'O painel teve um erro.';
				toast(message, 'alert');
				options.failure?.(message, undefined);
			} else {
				// A redirect (e.g. to the login after a 401, or away from a deleted item).
				await update();
			}
		};
	};
}
