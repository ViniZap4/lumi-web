<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';

	type Props = {
		label: string;
		icon: IconName;
		value: string;
		hint?: string;
		tone?: 'neutral' | 'ok' | 'warn' | 'alert';
		href?: string;
	};
	let { label, icon, value, hint, tone = 'neutral', href }: Props = $props();
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="stat {tone}" class:link={!!href}>
	<span class="top">
		<span class="icon"><Icon name={icon} size={17} /></span>
		<span class="label">{label}</span>
		{#if href}<span class="go"><Icon name="chevron" size={15} /></span>{/if}
	</span>
	<span class="value">{value}</span>
	{#if hint}<span class="hint">{hint}</span>{/if}
</svelte:element>

<style>
	.stat {
		--tone: var(--color-primary);
		--tone-soft: var(--soft-primary);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
		padding: 1rem 1.1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-1);
		color: var(--color-text);
		text-decoration: none;
		transition:
			transform 160ms ease,
			border-color 160ms ease;
	}
	.ok {
		--tone: var(--color-success);
		--tone-soft: var(--soft-success);
	}
	.warn {
		--tone: var(--color-warning);
		--tone-soft: var(--soft-warning);
		border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
	}
	.alert {
		--tone: var(--color-error);
		--tone-soft: var(--soft-error);
		border-color: color-mix(in srgb, var(--color-error) 40%, transparent);
	}
	.link:hover {
		transform: translateY(-2px);
		border-color: var(--color-border-strong);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		background: var(--tone-soft);
		color: var(--tone);
	}
	.label {
		flex: 1;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-2);
	}
	.go {
		color: var(--color-text-dim);
	}
	.value {
		font-family: var(--font-mono);
		font-size: 1.55rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		line-height: 1.15;
		overflow-wrap: anywhere;
	}
	.hint {
		font-size: 0.78rem;
		color: var(--color-text-dim);
	}
</style>
