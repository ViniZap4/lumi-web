<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';
	import { dismiss, toasts } from '../toast.svelte.ts';

	const icons: Record<string, IconName> = { ok: 'check', alert: 'alert', warn: 'alert', info: 'info' };
</script>

<div class="toaster" role="status" aria-live="polite" aria-relevant="additions">
	{#each toasts.list as t (t.id)}
		<div class="toast {t.tone}">
			<Icon name={icons[t.tone]} size={18} />
			<p>{t.message}</p>
			<button type="button" class="close" aria-label="Fechar aviso" onclick={() => dismiss(t.id)}>
				<Icon name="x" size={16} />
			</button>
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 50;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: min(26rem, calc(100vw - 2rem));
		pointer-events: none;
	}
	.toast {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.75rem 0.85rem;
		border: 1px solid var(--color-border-strong);
		border-left: 3px solid var(--tone);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow-2);
		color: var(--color-text);
		pointer-events: auto;
		animation: slide 180ms ease-out;
		--tone: var(--color-success);
	}
	.toast > :global(svg) {
		flex: none;
		color: var(--tone);
		margin-top: 1px;
	}
	.alert {
		--tone: var(--color-error);
	}
	.warn {
		--tone: var(--color-warning);
	}
	.info {
		--tone: var(--color-info);
	}
	p {
		flex: 1;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.close {
		display: grid;
		place-items: center;
		flex: none;
		width: 24px;
		height: 24px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-dim);
		cursor: pointer;
	}
	.close:hover {
		color: var(--color-text);
		background: var(--color-selected-bg);
	}
	@keyframes slide {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
