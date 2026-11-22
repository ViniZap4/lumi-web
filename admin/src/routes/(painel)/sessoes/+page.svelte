<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import { formatDate, formatDateTime, formatRelative, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let target = $state<{ id: string; username: string } | null>(null);
	let open = $state(false);
	const filteredName = $derived(data.user ? (data.items[0]?.username ?? null) : null);
	const now = Date.now();
</script>

<svelte:head>
	<title>Sessões · lumi · Administração</title>
</svelte:head>

<PageHeader eyebrow="Contas" title="Sessões"
	subtitle="Sessões de usuário não expiradas, mais novas primeiro. O id é o hash do token: identifica, mas não autentica.">
	{#snippet actions()}
		{#if data.user}<a class="btn ghost" href="/sessoes">Mostrar todas</a>{/if}
	{/snippet}
</PageHeader>

{#if data.user}
	<p class="muted">Só as sessões de <a href="/usuarios/{data.user}">{filteredName ?? shortId(data.user)}</a>.</p>
{/if}

<div class="table-card">
	{#if data.items.length === 0}
		<EmptyState icon="activity" title="Nenhuma sessão ativa" description="Ninguém está conectado agora." />
	{:else}
		<div class="table-scroll">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Usuário</th>
						<th scope="col">Sessão</th>
						<th scope="col">Criada</th>
						<th scope="col">Último uso</th>
						<th scope="col">Expira</th>
						<th scope="col"><span class="sr-only">Ações</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as s (s.id)}
						{@const idle = now - Date.parse(s.lastUsedAt) > 7 * 24 * 3600_000}
						<tr>
							<td class="primary">
								<a class="row-link" href="/usuarios/{s.userId}"><Avatar name={s.username} size={26} /> {s.username}</a>
							</td>
							<td data-label="Sessão" class="mono" title={s.id}>{shortId(s.id)}</td>
							<td data-label="Criada" title={formatDateTime(s.createdAt)}>{formatDate(s.createdAt)}</td>
							<td data-label="Último uso" title={formatDateTime(s.lastUsedAt)} class:muted={idle}>{formatRelative(s.lastUsedAt)}</td>
							<td data-label="Expira" title={formatDateTime(s.expiresAt)}>{formatRelative(s.expiresAt)}</td>
							<td class="actions">
								<button class="btn small danger" type="button" onclick={() => { target = { id: s.id, username: s.username }; open = true; }}>
									Encerrar
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
<Pager next={data.next} label="Páginas de sessões" />

{#if target}
	<ConfirmDialog bind:open title="Encerrar a sessão de {target.username}?" action="?/revoke"
		fields={{ session: target.id }} confirmLabel="Encerrar sessão" danger>
		<p>O aparelho dessa sessão ({shortId(target.id)}) precisa entrar de novo. Para encerrar todas de uma vez, use a página do usuário.</p>
	</ConfirmDialog>
{/if}
