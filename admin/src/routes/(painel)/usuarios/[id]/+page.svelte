<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { withFlash } from '#lib/enhance.ts';
	import { formatBytes, formatDate, formatDateTime, formatInt, formatRelative, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const user = $derived(data.user);

	type VaultRef = { id: string; slug: string; name: string };

	let passwordOpen = $state(false);
	let disableOpen = $state(false);
	let deleteOpen = $state(false);
	let revoking = $state<{ id: string; label: string } | null>(null);
	let revokeOpen = $state(false);
	let busy = $state<string | null>(null);
	let password = $state('');
	let repeat = $state('');
	/** Set by a 409 sole_admin_vaults answer, or up front from the vaults the user owns. */
	let soleVaults = $state<VaultRef[] | null>(null);
	let ackVaults = $state(false);

	const owned = $derived<VaultRef[]>(
		data.vaults.filter((v) => v.owner.id === user.id).map((v) => ({ id: v.id, slug: v.slug, name: v.name }))
	);
	const vaultsToDelete = $derived(soleVaults ?? (user.ownedVaults > 0 ? owned : []));

	$effect(() => {
		if (!passwordOpen) {
			password = '';
			repeat = '';
		}
	});
	$effect(() => {
		if (!deleteOpen) {
			ackVaults = false;
			soleVaults = null;
		}
	});

	function track(name: string) {
		return withFlash({ pending: (on) => (busy = on ? name : null) });
	}
</script>

<svelte:head>
	<title>{user.username} · Usuários · lumi · Administração</title>
</svelte:head>

<nav class="crumbs" aria-label="Trilha">
	<a href="/usuarios">Usuários</a> <span aria-hidden="true">/</span> <span aria-current="page">{user.username}</span>
</nav>

{#if data.created}
	<p class="banner ok" role="status">Usuário criado.</p>
{/if}

<div class="page-head">
	<div>
		<h1>{user.username}</h1>
		<p class="row">
			<StatePill state={user.state} />
			{#if user.displayName}<span>{user.displayName}</span>{/if}
			<span class="muted">desde {formatDate(user.createdAt)}</span>
			<span class="muted mono" title={user.id}>{shortId(user.id)}</span>
		</p>
	</div>
	<div class="row">
		<button class="btn" type="button" onclick={() => (passwordOpen = true)}>Redefinir senha</button>
		{#if user.state === 'locked' || user.failedLogins > 0}
			<form method="POST" action="?/unlock" use:enhance={track('unlock')}>
				<button class="btn" type="submit" disabled={busy === 'unlock'}>Desbloquear</button>
			</form>
		{/if}
		{#if user.state === 'disabled'}
			<form method="POST" action="?/enable" use:enhance={track('enable')}>
				<button class="btn" type="submit" disabled={busy === 'enable'}>Reativar</button>
			</form>
		{:else}
			<button class="btn danger" type="button" onclick={() => (disableOpen = true)}>Desativar</button>
		{/if}
		<button class="btn danger solid" type="button" onclick={() => (deleteOpen = true)}>Apagar</button>
	</div>
</div>

<section class="card">
	<dl class="facts">
		<dt>Id</dt>
		<dd class="mono">{user.id}</dd>
		<dt>Estado</dt>
		<dd>
			<StatePill state={user.state} />
			{#if user.disabledAt}<span class="muted"> desde {formatDateTime(user.disabledAt)}</span>{/if}
		</dd>
		<dt>Falhas de login</dt>
		<dd>
			{formatInt(user.failedLogins)}
			{#if user.lockedUntil}<span class="muted"> · bloqueado até {formatDateTime(user.lockedUntil)}</span>{/if}
		</dd>
		<dt>Sessões ativas</dt>
		<dd>{formatInt(user.sessions)}</dd>
		<dt>Cofres</dt>
		<dd>{formatInt(user.vaults)} (dono de {formatInt(user.ownedVaults)})</dd>
	</dl>
</section>

<section>
	<h2>Sessões</h2>
	{#if data.sessions.length === 0}
		<p class="muted">Nenhuma sessão ativa.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th scope="col">Sessão</th>
						<th scope="col">Criada</th>
						<th scope="col">Último uso</th>
						<th scope="col">Expira</th>
						<th scope="col"><span class="sr-only">Ações</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.sessions as s (s.id)}
						<tr>
							<td class="mono" title={s.id}>{shortId(s.id)}</td>
							<td>{formatDateTime(s.createdAt)}</td>
							<td>{formatRelative(s.lastUsedAt)}</td>
							<td>{formatDateTime(s.expiresAt)}</td>
							<td class="actions">
								<button class="btn small danger" type="button"
									onclick={() => { revoking = { id: s.id, label: shortId(s.id) }; revokeOpen = true; }}>
									Encerrar
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if data.sessionsMore}<p class="hint">Mostrando as 200 mais recentes.</p>{/if}
	{/if}
</section>

<section>
	<h2>Cofres</h2>
	{#if data.vaults.length === 0}
		<p class="muted">Não participa de nenhum cofre.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th scope="col">Cofre</th>
						<th scope="col">Papel</th>
						<th scope="col" class="num">Notas</th>
						<th scope="col" class="num">Tamanho (CRDT)</th>
					</tr>
				</thead>
				<tbody>
					{#each data.vaults as v (v.id)}
						<tr>
							<td><a href="/cofres/{v.id}">{v.slug}</a> <span class="muted">{v.name}</span></td>
							<td>{v.owner.id === user.id ? 'dono' : 'membro'}</td>
							<td class="num">{formatInt(v.notes)}</td>
							<td class="num">{formatBytes(v.crdtBytes)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<ConfirmDialog bind:open={passwordOpen} title="Redefinir a senha de {user.username}" action="?/password"
	confirmLabel="Redefinir senha" ready={password.length > 0 && password === repeat}>
	<p>Zera as falhas e o bloqueio e encerra todas as sessões do usuário.</p>
	<div class="field">
		<label for="pw-new">Nova senha</label>
		<input id="pw-new" name="password" type="password" autocomplete="new-password" required minlength="8" bind:value={password} />
		<span class="hint">8 a 72 bytes, não só dígitos; só letras exige 10.</span>
	</div>
	<div class="field">
		<label for="pw-repeat">Repita a nova senha</label>
		<input id="pw-repeat" name="password_repeat" type="password" autocomplete="new-password" required bind:value={repeat} />
	</div>
	{#if repeat && password !== repeat}<p class="hint" role="status">As senhas não conferem.</p>{/if}
</ConfirmDialog>

<ConfirmDialog bind:open={disableOpen} title="Desativar {user.username}?" action="?/disable" confirmLabel="Desativar" danger>
	<p>O usuário não consegue mais entrar e todas as sessões dele são encerradas. Dá para reativar depois.</p>
</ConfirmDialog>

{#if revoking}
	<ConfirmDialog bind:open={revokeOpen} title="Encerrar a sessão {revoking.label}?" action="?/revokeSession"
		fields={{ session: revoking.id }} confirmLabel="Encerrar sessão" danger>
		<p>O dispositivo dessa sessão precisa entrar de novo.</p>
	</ConfirmDialog>
{/if}

<ConfirmDialog bind:open={deleteOpen} title="Apagar {user.username}?" action="?/delete" confirmLabel="Apagar para sempre"
	danger requireText={user.username} requireLabel="Para confirmar, digite o nome de usuário"
	fields={vaultsToDelete.length > 0 && ackVaults ? { delete_owned_vaults: 'true' } : {}}
	ready={vaultsToDelete.length === 0 || ackVaults}
	onfailure={(_, d) => {
		if (d && Array.isArray(d.soleAdminVaults)) soleVaults = d.soleAdminVaults as VaultRef[];
	}}>
	<p>
		Apagamento definitivo (LGPD): a conta, as sessões e as participações em cofres somem, e as linhas de auditoria
		dele são anonimizadas. Não há como desfazer.
	</p>
	{#if vaultsToDelete.length > 0}
		<div class="banner alert">
			<p><strong>{user.username} é dono de {vaultsToDelete.length} {vaultsToDelete.length === 1 ? 'cofre' : 'cofres'}</strong>, que serão apagados junto, com todas as notas, membros e vínculos de federação:</p>
			<ul class="vaults">
				{#each vaultsToDelete as v (v.id)}
					<li><span class="mono">{v.slug}</span> {#if v.name}<span class="muted">{v.name}</span>{/if}</li>
				{/each}
			</ul>
			<label class="check">
				<input type="checkbox" bind:checked={ackVaults} />
				<span>Entendo que {vaultsToDelete.length === 1 ? 'esse cofre será apagado' : 'esses cofres serão apagados'} também.</span>
			</label>
		</div>
	{/if}
</ConfirmDialog>

<style>
	.crumbs {
		margin-bottom: 0.75rem;
		font-size: 0.9rem;
	}
	section {
		margin-bottom: 1.5rem;
	}
	.vaults {
		margin: 0.5rem 0;
		padding-left: 1.2rem;
		color: var(--color-text);
	}
</style>
