<script lang="ts">
	import Pager from '#lib/components/Pager.svelte';
	import { formatBytes, formatDate, formatInt } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const roles = { home: 'origem', follower: 'seguidor' } as const;
</script>

<svelte:head>
	<title>Cofres · lumi · Administração</title>
</svelte:head>

<div class="page-head"><h1>Cofres</h1></div>

{#if data.deleted}
	<p class="banner ok" role="status">Cofre “{data.deleted}” apagado.</p>
{/if}

{#if data.items.length === 0}
	<p class="muted">Nenhum cofre.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Cofre</th>
					<th scope="col">Dono</th>
					<th scope="col" class="num">Membros</th>
					<th scope="col" class="num">Notas</th>
					<th scope="col" class="num">CRDT</th>
					<th scope="col">Federação</th>
					<th scope="col">Criado</th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as v (v.id)}
					<tr>
						<td><a href="/cofres/{v.id}">{v.slug}</a> <span class="muted">{v.name}</span></td>
						<td><a href="/usuarios/{v.owner.id}">{v.owner.username}</a></td>
						<td class="num">{formatInt(v.members)}{v.federatedMembers ? ` + ${formatInt(v.federatedMembers)}` : ''}</td>
						<td class="num">{formatInt(v.notes)}</td>
						<td class="num">{formatBytes(v.crdtBytes)}</td>
						<td>{v.federation ? `${roles[v.federation.role]} · ${v.federation.activeLinks} ativo(s)` : '—'}</td>
						<td>{formatDate(v.createdAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
<Pager next={data.next} label="Páginas de cofres" />
