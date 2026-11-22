<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import { withFlash } from '../enhance.ts';
	import { confirmed } from '../rules.ts';

	type Props = {
		open?: boolean;
		title: string;
		action: string;
		fields?: Record<string, string>;
		confirmLabel: string;
		danger?: boolean;
		/** Destructive actions ask to type this first; the server action checks it again. */
		requireText?: string;
		requireLabel?: string;
		/** Extra gate from the caller, e.g. an acknowledgement checkbox inside `children`. */
		ready?: boolean;
		children?: Snippet;
		onfailure?: (message: string, data: Record<string, unknown> | undefined) => void;
	};

	let {
		open = $bindable(false),
		title,
		action,
		fields = {},
		confirmLabel,
		danger = false,
		requireText,
		requireLabel,
		ready = true,
		children,
		onfailure
	}: Props = $props();

	const uid = $props.id();
	let dialog: HTMLDialogElement | undefined = $state();
	let typed = $state('');
	let pending = $state(false);
	let error = $state('');
	const matches = $derived(!requireText || confirmed(typed, requireText));

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			typed = '';
			error = '';
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});
</script>

<dialog
	bind:this={dialog}
	class="confirm"
	class:danger
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-body"
	role={danger ? 'alertdialog' : 'dialog'}
	onclose={() => (open = false)}
>
	<form
		method="POST"
		{action}
		use:enhance={withFlash({
			pending: (on) => (pending = on),
			success: () => (open = false),
			failure: (message, data) => {
				error = message;
				onfailure?.(message, data);
			}
		})}
	>
		<h2 id="{uid}-title">{title}</h2>
		<div id="{uid}-body" class="body">
			{#each Object.entries(fields) as [name, value] (name)}
				<input type="hidden" {name} {value} />
			{/each}
			{@render children?.()}
			{#if requireText}
				<div class="field">
					<label for="{uid}-confirm">
						{requireLabel ?? 'Para confirmar, digite'} <strong class="target">{requireText}</strong>
					</label>
					<input
						id="{uid}-confirm"
						type="text"
						name="confirm"
						bind:value={typed}
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						required
					/>
				</div>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
		</div>
		<div class="footer">
			<button type="button" class="btn ghost" onclick={() => (open = false)}>Cancelar</button>
			<button
				type="submit"
				class="btn {danger ? 'danger solid' : 'primary'}"
				disabled={!matches || !ready || pending}
				aria-busy={pending}
			>
				{pending ? 'Aguarde…' : confirmLabel}
			</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		width: min(32rem, calc(100vw - 2rem));
		padding: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-overlay-bg);
		color: var(--color-text);
	}
	dialog.danger {
		border-color: var(--color-error);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.55);
	}
	.body {
		color: var(--color-text);
	}
	.target {
		color: var(--color-text);
		user-select: all;
	}
	.error {
		color: var(--color-error);
	}
	.footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}
</style>
