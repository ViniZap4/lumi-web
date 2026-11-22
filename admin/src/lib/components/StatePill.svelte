<script lang="ts">
	type Props = { state: string; label?: string };
	let { state, label }: Props = $props();

	const labels: Record<string, string> = {
		active: 'ativo',
		disabled: 'desativado',
		locked: 'bloqueado',
		expired: 'expirado',
		revoked: 'revogado',
		severed: 'rompido',
		exhausted: 'esgotado'
	};
	const tone = $derived(
		state === 'active'
			? 'ok'
			: state === 'locked'
				? 'warn'
				: state === 'disabled' || state === 'severed'
					? 'alert'
					: 'neutral'
	);
</script>

<span class="pill {tone}"><span class="dot" aria-hidden="true"></span>{label ?? labels[state] ?? state}</span>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.05rem 0.55rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.6;
		white-space: nowrap;
		background: var(--soft);
		color: var(--fg);
		--soft: var(--color-selected-bg);
		--fg: var(--color-text-dim);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.ok {
		--soft: var(--soft-success);
		--fg: var(--color-success);
	}
	.warn {
		--soft: var(--soft-warning);
		--fg: var(--color-warning);
	}
	.alert {
		--soft: var(--soft-error);
		--fg: var(--color-error);
	}
</style>
