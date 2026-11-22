<script lang="ts">
	import type { AdminFederation } from '#lib/admin.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { formatDate, formatDateTime, formatInt } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let target = $state<AdminFederation | null>(null);
	let open = $state(false);
	const roles = { home: 'origem', follower: 'seguidor' } as const;

	/** Home side only: how many control-plane changes the follower hasn't confirmed yet. */
	function lag(f: AdminFederation): number | null {
		return f.role === 'home' && f.controlSeq !== null ? Math.max(0, f.controlSeq - f.lastAckedSeq) : null;
	}
	const active = $derived(data.items.filter((f) => f.status === 'active').length);
</script>

<svelte:head>
	<title>Federações · lumi · Administração</title>
</svelte:head>

<PageHeader eyebrow="Conteúdo" title="Federações"
	subtitle="Vínculos de cofres deste servidor com outros servidores lumi. O papel é o deste servidor: origem guarda o cofre, seguidor espelha.">
	{#snippet actions()}
		{#if data.vault}<a class="btn ghost" href="/federacoes">Mostrar todas</a>{/if}
	{/snippet}
</PageHeader>

{#if data.items.length > 0}
	<p class="muted">{formatInt(active)} ativo(s) nesta página. “Pendentes” conta as mudanças de controle que o seguidor ainda não confirmou.</p>
{/if}

<div class="table-card">
	{#if data.items.length === 0}
		<EmptyState icon="globe" title="Nenhum vínculo de federação" description="Quando um cofre for federado com outro servidor, o vínculo aparece aqui." />
	{:else}
		<div class="table-scroll">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Cofre</th>
						<th scope="col">Par</th>
						<th scope="col">Papel</th>
						<th scope="col">Estado</th>
						<th scope="col" class="num">Seq. confirmada</th>
						<th scope="col" class="num">Pendentes</th>
						<th scope="col">Jurisdição</th>
						<th scope="col">Criado</th>
						<th scope="col"><span class="sr-only">Ações</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as f (f.id)}
						{@const l = lag(f)}
						<tr class:dim={f.status !== 'active'}>
							<td class="primary"><a class="row-link" href="/cofres/{f.vault.id}"><span class="mono">{f.vault.slug}</span></a></td>
							<td data-label="Par" class="url wide">{f.peerUrl}</td>
							<td data-label="Papel">{roles[f.role]}</td>
							<td data-label="Estado">
								<StatePill state={f.status} />
								{#if f.revokedAt}<span class="muted" title={formatDateTime(f.revokedAt)}> {formatDate(f.revokedAt)}</span>{/if}
							</td>
							<td data-label="Seq. confirmada" class="num">{formatInt(f.lastAckedSeq)}</td>
							<td data-label="Pendentes" class="num" class:warn={l !== null && l > 0 && f.status === 'active'}>{l === null ? '—' : formatInt(l)}</td>
							<td data-label="Jurisdição">{f.jurisdiction ?? '—'}</td>
							<td data-label="Criado" class="muted">{formatDate(f.createdAt)}</td>
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
</div>
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
	td.warn {
		color: var(--color-warning);
		font-weight: 650;
	}
</style>
