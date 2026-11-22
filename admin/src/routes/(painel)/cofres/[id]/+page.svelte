<script lang="ts">
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { formatBytes, formatDateTime, formatInt } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const v = $derived(data.vault);
	let deleteOpen = $state(false);
	const roles = { home: 'origem', follower: 'seguidor' } as const;
</script>

<svelte:head>
	<title>{v.slug} · Cofres · lumi · Administração</title>
</svelte:head>

<nav class="crumbs" aria-label="Trilha">
	<a href="/cofres">Cofres</a> <span aria-hidden="true">/</span> <span aria-current="page">{v.slug}</span>
</nav>

<div class="page-head">
	<div>
		<h1>{v.name || v.slug}</h1>
		<p class="muted mono">{v.slug}</p>
	</div>
	<button class="btn danger solid" type="button" onclick={() => (deleteOpen = true)}>Apagar cofre</button>
</div>

<section class="card">
	<dl class="facts">
		<dt>Id</dt>
		<dd class="mono">{v.id}</dd>
		<dt>Dono</dt>
		<dd><a href="/usuarios/{v.owner.id}">{v.owner.username}</a></dd>
		<dt>Membros</dt>
		<dd>{formatInt(v.members)} locais · {formatInt(v.federatedMembers)} federados</dd>
		<dt>Notas</dt>
		<dd>{formatInt(v.notes)}</dd>
		<dt>Dados CRDT</dt>
		<dd>{formatBytes(v.crdtBytes)} <span class="muted">(snapshots e atualizações Yjs, não o disco)</span></dd>
		<dt>Federação</dt>
		<dd>{v.federation ? `${roles[v.federation.role]} · ${v.federation.activeLinks} vínculo(s) ativo(s)` : 'não federado'}</dd>
		<dt>Criado</dt>
		<dd>{formatDateTime(v.createdAt)}</dd>
	</dl>
	<p class="row"><a href="/auditoria?cofre={v.id}">Auditoria deste cofre</a></p>
</section>

{#if data.federations.length > 0}
	<section>
		<h2>Vínculos de federação</h2>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th scope="col">Par</th><th scope="col">Papel</th><th scope="col">Estado</th><th scope="col">Criado</th></tr>
				</thead>
				<tbody>
					{#each data.federations as f (f.id)}
						<tr>
							<td>{f.peerUrl}</td>
							<td>{roles[f.role]}</td>
							<td><StatePill state={f.status} /></td>
							<td>{formatDateTime(f.createdAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="hint">Para revogar, use a página <a href="/federacoes?cofre={v.id}">Federações</a>.</p>
	</section>
{/if}

<ConfirmDialog bind:open={deleteOpen} title="Apagar o cofre {v.slug}?" action="?/delete" confirmLabel="Apagar para sempre"
	danger requireText={v.slug} requireLabel="Para confirmar, digite o identificador do cofre">
	<p>
		Apaga {formatInt(v.notes)} {v.notes === 1 ? 'nota' : 'notas'}, os papéis, os {formatInt(v.members)} membros, os
		convites, os vínculos de federação e o diretório do cofre no disco. Não há como desfazer (só o backup).
	</p>
</ConfirmDialog>

<style>
	.crumbs {
		margin-bottom: 0.75rem;
		font-size: 0.9rem;
	}
</style>
