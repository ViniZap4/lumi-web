<script lang="ts">
	import { daysUntil, formatDateTime, formatInt, formatRelative } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const s = $derived(data.status);
	const days = $derived(daysUntil(s.token.expiresAt));

	const cards = $derived([
		{ label: 'Usuários', value: s.users, href: '/usuarios' },
		{ label: 'Sessões ativas', value: s.sessions, href: '/sessoes' },
		{ label: 'Cofres', value: s.vaults, href: '/cofres' },
		{ label: 'Notas', value: s.notes, href: null },
		{ label: 'Federações', value: s.federations, href: '/federacoes' },
		{ label: 'Streams do feed', value: s.feedConnections, href: null },
		{ label: 'WebSockets de notas', value: s.wsConnections, href: null }
	]);
</script>

<svelte:head>
	<title>Visão geral · lumi · Administração</title>
</svelte:head>

<div class="page-head">
	<h1>Visão geral</h1>
	<span class="muted">lumi-server {s.version}</span>
</div>

{#if s.schemaDirty}
	<p class="banner alert" role="alert">
		O esquema do banco está marcado como <strong>sujo</strong> (versão {s.schemaVersion}): uma migração falhou no
		meio. Corrija antes de qualquer outra ação.
	</p>
{:else if s.pendingMigrations > 0}
	<p class="banner warn" role="alert">
		{s.pendingMigrations}
		{s.pendingMigrations === 1 ? 'migração pendente' : 'migrações pendentes'} no banco (versão atual {s.schemaVersion}).
	</p>
{/if}
{#if days < 7}
	<p class="banner warn">
		O token “{s.token.name}” expira {formatRelative(s.token.expiresAt)}. Crie outro no terminal antes disso.
	</p>
{/if}

<ul class="grid">
	{#each cards as card (card.label)}
		<li class="card stat">
			<span class="muted">{card.label}</span>
			{#if card.href}
				<a class="value" href={card.href}>{formatInt(card.value)}</a>
			{:else}
				<span class="value">{formatInt(card.value)}</span>
			{/if}
		</li>
	{/each}
</ul>

<section class="card">
	<h2>Servidor</h2>
	<dl class="facts">
		<dt>Versão</dt>
		<dd>{s.version}</dd>
		<dt>Esquema</dt>
		<dd>{s.schemaVersion}{s.schemaDirty ? ' (sujo)' : ''} · {s.pendingMigrations} pendente(s)</dd>
		<dt>No ar desde</dt>
		<dd>{formatDateTime(s.startedAt)} ({formatRelative(s.startedAt)})</dd>
		<dt>Token em uso</dt>
		<dd>{s.token.name} · expira em {formatDateTime(s.token.expiresAt)}</dd>
	</dl>
</section>

<style>
	.grid {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.75rem;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
	}
	.value {
		font-size: 1.6rem;
		font-weight: 600;
		color: var(--color-primary);
		text-decoration: none;
		font-variant-numeric: tabular-nums;
	}
	a.value:hover {
		text-decoration: underline;
	}
</style>
