<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import { toast } from '../toast.svelte.ts';

	type Props = { open?: boolean; title: string; secret: string | null; children?: Snippet };
	let { open = $bindable(false), title, secret, children }: Props = $props();

	const uid = $props.id();
	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	async function copy() {
		if (!secret) return;
		try {
			await navigator.clipboard.writeText(secret);
			toast('Copiado.', 'ok');
		} catch {
			toast('Não deu para copiar: selecione e copie à mão.', 'warn');
		}
	}
</script>

<!-- The secret lives only in this component's state; closing the dialog drops it from the page. -->
<dialog bind:this={dialog} aria-labelledby="{uid}-t" onclose={() => (open = false)}>
	<h2 id="{uid}-t">{title}</h2>
	{@render children?.()}
	{#if secret}
		<div class="secret">
			<code class="value">{secret}</code>
			<button class="btn small" type="button" onclick={copy}><Icon name="copy" size={15} /> Copiar</button>
		</div>
		<p class="hint">Aparece só agora: o painel não guarda essa senha. Peça para a pessoa trocá-la depois de entrar.</p>
	{/if}
	<div class="footer">
		<button class="btn primary" type="button" onclick={() => (open = false)}>Pronto</button>
	</div>
</dialog>

<style>
	dialog {
		width: min(34rem, calc(100vw - 2rem));
		padding: 1.4rem;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-2);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.55);
	}
	.secret {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0.75rem 0 0.5rem;
		padding: 0.6rem 0.75rem;
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius);
		background: var(--color-background);
	}
	.value {
		flex: 1;
		font-size: 1.05rem;
		letter-spacing: 0.04em;
		user-select: all;
		overflow-wrap: anywhere;
	}
	.footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 1rem;
	}
</style>
