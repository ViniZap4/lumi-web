<script lang="ts">
	import type { AuditEntry } from '../admin.ts';
	import { actionLabel, actionTone, actorOf, targetOf } from '../audit.ts';
	import { formatDateTime, formatRelative, shortId } from '../format.ts';

	type Props = { entries: readonly AuditEntry[]; empty?: string };
	let { entries, empty = 'Nada registrado ainda.' }: Props = $props();
</script>

{#if entries.length === 0}
	<p class="muted none">{empty}</p>
{:else}
	<ol class="feed">
		{#each entries as e (e.id)}
			{@const actor = actorOf(e)}
			{@const target = targetOf(e)}
			<li class={actionTone(e.action)}>
				<span class="dot" aria-hidden="true"></span>
				<div class="body">
					<p class="what">
						<span title={e.action}>{actionLabel(e.action)}</span>
						{#if target}<span class="target">{target}</span>{/if}
					</p>
					<p class="meta">
						<time datetime={e.createdAt} title={formatDateTime(e.createdAt)}>{formatRelative(e.createdAt)}</time>
						{#if actor}<span>· {actor}</span>{/if}
						{#if e.userId}<a href="/usuarios/{e.userId}">usuário {shortId(e.userId)}</a>{/if}
						{#if e.vaultId}<a href="/cofres/{e.vaultId}">cofre {shortId(e.vaultId)}</a>{/if}
						{#if e.ip}<span class="mono">{e.ip}</span>{/if}
					</p>
				</div>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.none {
		margin: 0;
	}
	.feed {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		--tone: var(--color-muted);
		position: relative;
		display: flex;
		gap: 0.75rem;
		padding: 0.55rem 0;
	}
	li + li {
		border-top: 1px solid var(--color-separator);
	}
	.admin {
		--tone: var(--color-secondary);
	}
	.alert {
		--tone: var(--color-error);
	}
	.auth {
		--tone: var(--color-accent);
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		margin-top: 0.45rem;
		border-radius: 50%;
		background: var(--tone);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 20%, transparent);
	}
	.body {
		min-width: 0;
	}
	p {
		margin: 0;
	}
	.what {
		font-weight: 550;
	}
	.target {
		margin-left: 0.35rem;
		font-family: var(--font-mono);
		font-size: 0.85rem;
		color: var(--color-text-2);
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.5rem;
		font-size: 0.8rem;
		color: var(--color-text-dim);
	}
	.meta a {
		color: var(--color-text-dim);
	}
	.meta a:hover {
		color: var(--color-primary);
	}
</style>
