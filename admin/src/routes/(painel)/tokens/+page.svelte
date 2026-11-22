<script lang="ts">
	import type { AdminToken } from '#lib/admin.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { daysUntil, formatDate, formatDateTime, formatRelative, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let target = $state<AdminToken | null>(null);
	let open = $state(false);
</script>

<svelte:head>
	<title>Tokens · lumi · Administração</title>
</svelte:head>

<PageHeader eyebrow="Servidor" title="Tokens de administração"
	subtitle="Quem pode usar este painel e a API de admin. Criados só no terminal; aqui dá para ver o uso e revogar." />

<div class="table-card">
	{#if data.items.length === 0}
		<EmptyState icon="key" title="Nenhum token" />
	{:else}
		<div class="table-scroll">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Nome</th>
						<th scope="col">Estado</th>
						<th scope="col">Último uso</th>
						<th scope="col">Expira</th>
						<th scope="col">Criado</th>
						<th scope="col"><span class="sr-only">Ações</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as t (t.id)}
						{@const soon = t.state === 'active' && daysUntil(t.expiresAt) < 7}
						<tr class:dim={t.state !== 'active'}>
							<td class="primary">
								<span class="name"><Icon name="key" size={15} /> <strong>{t.name}</strong></span>
								<span class="muted mono" title={t.id}>{shortId(t.id)}</span>
								{#if t.current}<StatePill state="active" label="este painel" />{/if}
							</td>
							<td data-label="Estado">
								<StatePill state={t.state} />
								{#if t.revokedAt}<span class="muted" title={formatDateTime(t.revokedAt)}> {formatDate(t.revokedAt)}</span>{/if}
							</td>
							<td data-label="Último uso" title={formatDateTime(t.lastUsedAt)}>{formatRelative(t.lastUsedAt)}</td>
							<td data-label="Expira" title={formatDateTime(t.expiresAt)} class:warn={soon}>{formatRelative(t.expiresAt)}</td>
							<td data-label="Criado" class="muted">{formatDate(t.createdAt)}</td>
							<td class="actions">
								{#if t.state === 'active'}
									<button class="btn small danger" type="button" onclick={() => { target = t; open = true; }}>Revogar</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
<Pager next={data.next} label="Páginas de tokens" />

<section class="card">
	<h2>Criar ou trocar um token</h2>
	<p>
		Tokens são criados <strong>só no terminal</strong>: a API lista e revoga, mas nunca cria, então um token vazado
		não gera outros. No servidor de casa (ZimaOS):
	</p>
	<pre class="cmd">docker compose -p lumi-prod exec server /lumi-server token create &lt;nome&gt; [--ttl 30d]</pre>
	<p class="hint">
		O token sai uma única vez no stdout. Validade padrão de 30 dias (de 1 minuto a 1 ano; <code>720h</code>,
		<code>90m</code> ou <code>30d</code>). Para trocar: crie o novo, entre com ele e revogue o antigo aqui.
	</p>
</section>

{#if target}
	<ConfirmDialog bind:open title="Revogar o token {target.name}?" action="?/revoke" fields={{ token: target.id }}
		confirmLabel="Revogar" danger requireText={target.name} requireLabel="Para confirmar, digite o nome do token">
		{#if target.current}
			<div class="banner alert"><p>Este é o token que o painel está usando: você sai logo em seguida.</p></div>
		{/if}
		<p>Scripts e painéis que usam esse token deixam de funcionar na próxima chamada. Não há como desfazer.</p>
	</ConfirmDialog>
{/if}

<style>
	.name {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-right: 0.4rem;
	}
	td.warn {
		color: var(--color-warning);
		font-weight: 650;
	}
</style>
