<script lang="ts">
	import type { AdminFederation } from '#lib/admin.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { formatDateTime, formatInt } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let target = $state<AdminFederation | null>(null);
	let open = $state(false);
	const roles = { home: 'origem', follower: 'seguidor' } as const;
</script>

<svelte:head>
	<title>Federações · lumi · Administração</title>
</svelte:head>

<div class="page-head">
	<h1>Federações</h1>
	{#if data.vault}<a class="btn ghost" href="/federacoes">Mostrar todas</a>{/if}
</div>
<p class="muted">Vínculos de federação deste servidor com outros. O papel é o <strong>deste</strong> servidor.</p>

{#if data.items.length === 0}
	<p class="muted">Nenhum vínculo de federação.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Cofre</th>
					<th scope="col">Par</th>
					<th scope="col">Papel</th>
					<th scope="col">Estado</th>
					<th scope="col" class="num">Seq. confirmada</th>
					<th scope="col">Jurisdição</th>
					<th scope="col">Criado</th>
					<th scope="col"><span class="sr-only">Ações</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as f (f.id)}
					<tr>
						<td><a href="/cofres/{f.vault.id}">{f.vault.slug}</a></td>
						<td class="url">{f.peerUrl}</td>
						<td>{roles[f.role]}</td>
						<td>
							<StatePill state={f.status} />
							{#if f.revokedAt}<span class="muted"> {formatDateTime(f.revokedAt)}</span>{/if}
						</td>
						<td class="num">{formatInt(f.lastAckedSeq)}{f.controlSeq !== null ? ` / ctl ${formatInt(f.controlSeq)}` : ''}</td>
						<td>{f.jurisdiction ?? '—'}</td>
						<td>{formatDateTime(f.createdAt)}</td>
						<td class="actions">
							{#if f.status === 'active'}
								<button class="btn small danger" type="button" onclick={() => { target = f; open = true; }}>Revogar</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
<Pager next={data.next} label="Páginas de federações" />

{#if target}
	<ConfirmDialog bind:open title="Revogar a federação de {target.vault.slug}?" action="?/revoke"
		fields={{ federation: target.id, vault: target.vault.id }} confirmLabel="Revogar" danger
		requireText={target.vault.slug} requireLabel="Para confirmar, digite o identificador do cofre">
		<p>
			O vínculo com <strong>{target.peerUrl}</strong> para de sincronizar. O cofre local fica; o registro do vínculo
			continua, como revogado. Não há como reativar: seria preciso federar de novo.
		</p>
	</ConfirmDialog>
{/if}

<style>
	.url {
		overflow-wrap: anywhere;
	}
</style>
