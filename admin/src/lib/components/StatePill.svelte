<script lang="ts">
	type Props = { state: string };
	let { state }: Props = $props();

	const labels: Record<string, string> = {
		active: 'ativo',
		disabled: 'desativado',
		locked: 'bloqueado',
		expired: 'expirado',
		revoked: 'revogado',
		severed: 'rompido'
	};
	const tone = $derived(
		state === 'active' ? 'ok' : state === 'locked' || state === 'expired' ? 'warn' : 'alert'
	);
</script>

<span class="pill {tone}">{labels[state] ?? state}</span>

<style>
	.pill {
		display: inline-block;
		padding: 0 0.5rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.ok {
		color: var(--color-success);
	}
	.warn {
		color: var(--color-warning);
	}
	.alert {
		color: var(--color-error);
	}
</style>
