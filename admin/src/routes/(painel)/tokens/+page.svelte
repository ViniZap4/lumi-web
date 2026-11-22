<script lang="ts">
	import type { AdminToken } from '#lib/admin.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { formatDateTime, formatRelative, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let target = $state<AdminToken | null>(null);
	let open = $state(false);
</script>

<svelte:head>
	<title>Tokens · lumi · Administração</title>
</svelte:head>

<div class="page-head"><h1>Tokens de administração</h1></div>

<section class="card">
	<h2>Criar um token</h2>
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

{#if data.items.length === 0}
	<p class="muted">Nenhum token.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Nome</th>
					<th scope="col">Estado</th>
					<th scope="col">Criado</th>
					<th scope="col">Último uso</th>
					<th scope="col">Expira</th>
					<th scope="col"><span class="sr-only">Ações</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as t (t.id)}
					<tr>
						<td>
							{t.name}
							<span class="muted mono" title={t.id}>{shortId(t.id)}</span>
							{#if t.current}<strong class="current">(este painel)</strong>{/if}
						</td>
						<td>
							<StatePill state={t.state} />
							{#if t.revokedAt}<span class="muted"> {formatDateTime(t.revokedAt)}</span>{/if}
						</td>
						<td>{formatDateTime(t.createdAt)}</td>
						<td>{formatRelative(t.lastUsedAt)}</td>
						<td>{formatDateTime(t.expiresAt)}</td>
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
<Pager next={data.next} label="Páginas de tokens" />

{#if target}
	<ConfirmDialog bind:open title="Revogar o token {target.name}?" action="?/revoke" fields={{ token: target.id }}
		confirmLabel="Revogar" danger requireText={target.name} requireLabel="Para confirmar, digite o nome do token">
		{#if target.current}
			<p class="banner alert">Este é o token que o painel está usando: você sai logo em seguida.</p>
		{/if}
		<p>Scripts e painéis que usam esse token deixam de funcionar na próxima chamada. Não há como desfazer.</p>
	</ConfirmDialog>
{/if}

<style>
	.current {
		color: var(--color-accent);
		font-size: 0.85rem;
	}
</style>
