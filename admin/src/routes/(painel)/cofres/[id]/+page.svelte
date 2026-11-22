<script lang="ts">
	import type { AdminFederation, AdminInvite } from '#lib/admin.ts';
	import AuditFeed from '#lib/components/AuditFeed.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { formatBytes, formatDate, formatDateTime, formatInt, formatRelative, plural, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const v = $derived(data.vault);
	const roles = { home: 'origem', follower: 'seguidor' } as const;

	let deleteOpen = $state(false);
	let invite = $state<AdminInvite | null>(null);
	let inviteOpen = $state(false);
	let fed = $state<AdminFederation | null>(null);
	let fedOpen = $state(false);

	const activeInvites = $derived((data.invites ?? []).filter((i) => i.state === 'active'));
	const otherInvites = $derived((data.invites ?? []).filter((i) => i.state !== 'active').slice(0, 10));
</script>

<svelte:head>
	<title>{v.slug} · Cofres · lumi · Administração</title>
</svelte:head>

<nav class="crumbs" aria-label="Trilha">
	<a href="/cofres">Cofres</a> <Icon name="chevron" size={14} /> <span aria-current="page">{v.slug}</span>
</nav>

<header class="head">
	<span class="glyph"><Icon name="vault" size={24} /></span>
	<div class="who">
		<h1>{v.name || v.slug}</h1>
		<p class="row">
			<span class="mono">{v.slug}</span>
			<span class="muted">dono <a href="/usuarios/{v.owner.id}">{v.owner.username || '—'}</a></span>
			<span class="muted">criado em {formatDate(v.createdAt)}</span>
			{#if v.federation}<StatePill state="active" label="federado · {roles[v.federation.role]}" />{/if}
		</p>
	</div>
	<button class="btn danger solid" type="button" onclick={() => (deleteOpen = true)}><Icon name="trash" size={16} /> Apagar cofre</button>
</header>

<div class="facts-grid">
	<div class="fact"><span class="k">Notas</span><span class="v">{formatInt(v.notes)}</span></div>
	<div class="fact"><span class="k">Tamanho (CRDT)</span><span class="v">{formatBytes(v.crdtBytes)}</span></div>
	<div class="fact"><span class="k">Membros</span><span class="v">{formatInt(v.members)}{#if v.federatedMembers}<small>&nbsp;+ {formatInt(v.federatedMembers)} federados</small>{/if}</span></div>
	<div class="fact"><span class="k">Última mudança</span><span class="v" title={formatDateTime(v.lastChangeAt)}>{v.lastChangeAt ? formatRelative(v.lastChangeAt) : '—'}</span></div>
	<div class="fact"><span class="k">Sequência</span><span class="v mono">#{formatInt(v.headSeq)}</span></div>
	<div class="fact"><span class="k">Convites válidos</span><span class="v">{formatInt(v.invitesActive)}</span></div>
</div>

<div class="grid-2">
	<div>
		<section class="block">
			<h2>Membros</h2>
			<div class="table-card">
				{#if data.members.length === 0}
					<EmptyState icon="users" title="Sem membros locais" />
				{:else}
					<table class="table">
						<thead><tr><th scope="col">Pessoa</th><th scope="col">Papel</th><th scope="col">Entrou</th></tr></thead>
						<tbody>
							{#each data.members as m (m.user.id)}
								<tr>
									<td class="primary">
										<a class="row-link" href="/usuarios/{m.user.id}">
											<Avatar name={m.displayName || m.user.username} size={28} />
											<span>{m.user.username}{#if m.displayName}<span class="sub">{m.displayName}</span>{/if}</span>
										</a>
									</td>
									<td data-label="Papel">
										{m.role.name}
										{#if m.owner}<StatePill state="active" label="dono" />{/if}
									</td>
									<td data-label="Entrou" class="muted">{formatDate(m.joinedAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
			{#if data.roles.length > 0}
				<ul class="roles" aria-label="Papéis do cofre">
					{#each data.roles as r (r.id)}
						<li title={r.seed ? 'papel padrão' : 'papel personalizado'}>
							<strong>{r.name}</strong> <span class="muted">{formatInt(r.members)}</span>{#if !r.seed}<span class="custom">personalizado</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="block">
			<h2>Convites</h2>
			<div class="table-card">
				{#if data.invites === null}
					<p class="muted pad">Convites indisponíveis agora.</p>
				{:else if activeInvites.length === 0 && otherInvites.length === 0}
					<EmptyState icon="mail" title="Nenhum convite" description="Convites são criados pelos admins do cofre, no app." />
				{:else}
					<table class="table">
						<thead><tr><th scope="col">Convite</th><th scope="col">Estado</th><th scope="col" class="num">Usos</th><th scope="col">Expira</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
						<tbody>
							{#each [...activeInvites, ...otherInvites] as i (i.id)}
								<tr class:dim={i.state !== 'active'}>
									<td class="primary">
										<span class="mono" title="Identificador (hash), não o link">{shortId(i.id)}</span>
										<span class="muted">· {i.role.name} · por {i.inviter.username || '—'}</span>
									</td>
									<td data-label="Estado"><StatePill state={i.state} /></td>
									<td data-label="Usos" class="num">{formatInt(i.useCount)} de {formatInt(i.maxUses)}</td>
									<td data-label="Expira" title={formatDateTime(i.expiresAt)}>{formatRelative(i.expiresAt)}</td>
									<td class="actions">
										{#if i.state === 'active'}
											<button class="btn small danger" type="button" onclick={() => { invite = i; inviteOpen = true; }}>Revogar</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</section>

		{#if data.federations.length > 0}
			<section class="block">
				<h2>Federação</h2>
				<div class="table-card">
					<table class="table">
						<thead><tr><th scope="col">Par</th><th scope="col">Papel</th><th scope="col">Estado</th><th scope="col" class="num">Seq.</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
						<tbody>
							{#each data.federations as f (f.id)}
								<tr class:dim={f.status !== 'active'}>
									<td class="primary url">{f.peerUrl}</td>
									<td data-label="Papel">{roles[f.role]}</td>
									<td data-label="Estado"><StatePill state={f.status} /></td>
									<td data-label="Seq." class="num">{formatInt(f.lastAckedSeq)}{f.controlSeq !== null ? ` / ${formatInt(f.controlSeq)}` : ''}</td>
									<td class="actions">
										{#if f.status === 'active'}
											<button class="btn small danger" type="button" onclick={() => { fed = f; fedOpen = true; }}>Revogar</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	</div>

	<section class="card">
		<div class="card-head">
			<h2>Atividade</h2>
			<a href="/auditoria?cofre={v.id}">Auditoria deste cofre</a>
		</div>
		{#if data.activity === null}
			<p class="muted">Auditoria indisponível agora.</p>
		{:else}
			<AuditFeed entries={data.activity} empty="Nada registrado para este cofre." />
		{/if}
	</section>
</div>

<ConfirmDialog bind:open={deleteOpen} title="Apagar o cofre {v.slug}?" action="?/delete" confirmLabel="Apagar para sempre"
	danger requireText={v.slug} requireLabel="Para confirmar, digite o identificador do cofre">
	<p>
		Apaga {plural(v.notes, 'nota', 'notas')}, os papéis, {plural(v.members, 'membro', 'membros')}, os convites, os
		vínculos de federação e o diretório do cofre no disco. Não há como desfazer (só o backup).
	</p>
</ConfirmDialog>

{#if invite}
	<ConfirmDialog bind:open={inviteOpen} title="Revogar o convite {shortId(invite.id)}?" action="?/revokeInvite"
		fields={{ invite: invite.id }} confirmLabel="Revogar convite" danger>
		<p>O link deixa de valer na hora: quem ainda não entrou por ele não entra mais. Quem já entrou continua membro.</p>
	</ConfirmDialog>
{/if}

{#if fed}
	<ConfirmDialog bind:open={fedOpen} title="Revogar a federação com {fed.peerUrl}?" action="?/revokeFederation"
		fields={{ federation: fed.id }} confirmLabel="Revogar" danger requireText={v.slug}
		requireLabel="Para confirmar, digite o identificador do cofre">
		<p>O vínculo para de sincronizar. O cofre local fica; o registro continua, como revogado. Para voltar, é preciso federar de novo.</p>
	</ConfirmDialog>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.25rem;
		margin: 0.5rem 0 1.25rem;
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 14px;
		background: var(--soft-secondary);
		color: var(--color-secondary);
	}
	.who {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.who h1 {
		margin: 0 0 0.3rem;
	}
	.who p {
		margin: 0;
	}
	.facts-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: 0.6rem;
		margin-bottom: 1.25rem;
	}
	.fact {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
	}
	.fact .k {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-dim);
	}
	.fact .v {
		font-weight: 650;
	}
	.fact small {
		font-weight: 400;
		color: var(--color-text-dim);
	}
	.roles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: -0.4rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
	}
	.roles li {
		padding: 0.15rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-surface);
	}
	.custom {
		margin-left: 0.35rem;
		color: var(--color-secondary);
		font-size: 0.75rem;
	}
	.url {
		overflow-wrap: anywhere;
	}
	.pad {
		padding: 1rem;
		margin: 0;
	}
</style>
