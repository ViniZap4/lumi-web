<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { eyebrow?: string; title: string; subtitle?: string; actions?: Snippet; meta?: Snippet };
	let { eyebrow, title, subtitle, actions, meta }: Props = $props();
</script>

<header class="page-header">
	<div class="text">
		{#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
		<h1>{title}</h1>
		{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
		{@render meta?.()}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
	.page-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		margin: 0.5rem 0 1.5rem;
	}
	.text {
		min-width: 0;
		flex: 1 1 20rem;
	}
	.eyebrow {
		margin: 0 0 0.25rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-primary);
	}
	h1 {
		margin: 0;
		font-size: 1.65rem;
		overflow-wrap: anywhere;
	}
	.subtitle {
		margin: 0.35rem 0 0;
		max-width: 60ch;
		color: var(--color-text-dim);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
</style>
