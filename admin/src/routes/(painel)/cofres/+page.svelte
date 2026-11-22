<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import { formatBytes, formatDateTime, formatInt, formatRelative } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const roles = { home: 'origem', follower: 'seguidor' } as const;
	const maxBytes = $derived(Math.max(1, ...data.items.map((v) => v.crdtBytes)));
</script>

<svelte:head>
	<title>Cofres · lumi · Administração</title>
</svelte:head>

<PageHeader eyebrow="Conteúdo" title="Cofres" subtitle="Os cofres hospedados aqui, com dono, membros, tamanho e a última mudança. O conteúdo das notas não aparece." />

{#if data.deleted}
	<div class="banner ok" role="status"><Icon name="check" /><p>Cofre “{data.deleted}” apagado.</p></div>
{/if}

<div class="toolbar">
	<form method="GET" class="search grow" role="search">
		<label class="sr-only" for="busca">Buscar cofres</label>
		<span class="search-icon"><Icon name="search" size={16} /></span>
		<input id="busca" name="busca" type="search" placeholder="Buscar por identificador ou nome" value={data.q}
			maxlength="64" autocomplete="off" spellcheck="false" />
	</form>
	{#if data.q}<a class="btn ghost" href="/cofres">Limpar</a>{/if}
</div>

<div class="table-card">
	{#if data.items.length === 0}
		<EmptyState icon="vault" title={data.q ? 'Nenhum cofre com essa busca' : 'Nenhum cofre ainda'}
			description={data.q ? 'Tente outro trecho do identificador ou do nome.' : 'Os cofres aparecem aqui quando alguém criar o primeiro.'} />
	{:else}
		<div class="table-scroll">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Cofre</th>
						<th scope="col">Dono</th>
						<th scope="col" class="num">Membros</th>
						<th scope="col" class="num">Notas</th>
						<th scope="col">Tamanho (CRDT)</th>
						<th scope="col">Última mudança</th>
						<th scope="col">Federação</th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as v (v.id)}
						<tr>
							<td class="primary">
								<a class="row-link" href="/cofres/{v.id}">
									<span class="mono">{v.slug}</span>{#if v.name}<span class="sub">{v.name}</span>{/if}
								</a>
							</td>
							<td data-label="Dono"><a href="/usuarios/{v.owner.id}">{v.owner.username || '—'}</a></td>
							<td data-label="Membros" class="num">{formatInt(v.members)}{v.federatedMembers ? ` + ${formatInt(v.federatedMembers)}` : ''}</td>
							<td data-label="Notas" class="num">{formatInt(v.notes)}</td>
							<td data-label="Tamanho" class="size">
								<span class="mono">{formatBytes(v.crdtBytes)}</span>
								<span class="bar" aria-hidden="true"><span style:width="{Math.max(2, (v.crdtBytes / maxBytes) * 100)}%"></span></span>
							</td>
							<td data-label="Última mudança" title={formatDateTime(v.lastChangeAt)}>{v.lastChangeAt ? formatRelative(v.lastChangeAt) : '—'}</td>
							<td data-label="Federação">
								{#if v.federation}
									<span class="fed">{roles[v.federation.role]} · {formatInt(v.federation.activeLinks)}</span>
								{:else}<span class="muted">—</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
<Pager next={data.next} label="Páginas de cofres" />
{#if data.items.length > 1}<p class="hint">Em ordem de identificador. As barras comparam os cofres desta página.</p>{/if}

<style>
	.search {
		position: relative;
	}
	.search-icon {
		position: absolute;
		left: 0.65rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-dim);
		display: grid;
	}
	.search input {
		padding-left: 2.1rem;
		min-height: 38px;
	}
	.size {
		min-width: 9rem;
	}
	.bar {
		display: block;
		height: 4px;
		margin-top: 0.3rem;
		border-radius: 999px;
		background: var(--color-selected-bg);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--color-primary);
		border-radius: inherit;
	}
	.fed {
		color: var(--color-accent);
	}
</style>
