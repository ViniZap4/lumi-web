<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	type Props = { icon: IconName; title: string; description?: string; children?: Snippet };
	let { icon, title, description, children }: Props = $props();
</script>

<div class="empty">
	<span class="icon"><Icon name={icon} size={22} /></span>
	<p class="title">{title}</p>
	{#if description}<p class="desc">{description}</p>{/if}
	{@render children?.()}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 2.5rem 1rem;
		text-align: center;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		margin-bottom: 0.4rem;
		border-radius: 12px;
		background: var(--soft-primary);
		color: var(--color-primary);
	}
	.title {
		margin: 0;
		font-weight: 650;
	}
	.desc {
		margin: 0;
		max-width: 44ch;
		color: var(--color-text-dim);
	}
</style>
