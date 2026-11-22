<script lang="ts">
	import { enhance } from '$app/forms';
	import AuditFeed from '#lib/components/AuditFeed.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PasswordChoice from '#lib/components/PasswordChoice.svelte';
	import SecretDialog from '#lib/components/SecretDialog.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { withToast } from '#lib/enhance.ts';
	import { formatBytes, formatDate, formatDateTime, formatInt, formatRelative, plural, shortId } from '#lib/format.ts';
	import { passwordReady } from '#lib/rules.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const user = $derived(data.user);

	type VaultRef = { id: string; slug: string; name: string };

	let passwordOpen = $state(false);
	let disableOpen = $state(false);
	let deleteOpen = $state(false);
	let logoutOpen = $state(false);
	let revoking = $state<{ id: string; label: string } | null>(null);
	let revokeOpen = $state(false);
	let busy = $state<string | null>(null);
	let mode = $state<'gerar' | 'definir'>('gerar');
	let password = $state('');
	let repeat = $state('');
	let generated = $state<string | null>(null);
	let generatedOpen = $state(false);
	/** Set by a 409 sole_admin_vaults answer, or up front from the vaults the user owns. */
	let soleVaults = $state<VaultRef[] | null>(null);
	let ackVaults = $state(false);

	const owned = $derived<VaultRef[]>(
		data.vaults.filter((v) => v.owner.id === user.id).map((v) => ({ id: v.id, slug: v.slug, name: v.name }))
	);
	const vaultsToDelete = $derived(soleVaults ?? (user.ownedVaults > 0 ? owned : []));
	const lockedNow = $derived(user.state === 'locked');

	$effect(() => {
		if (!passwordOpen) {
			password = '';
			repeat = '';
			mode = 'gerar';
		}
	});
	$effect(() => {
		if (!deleteOpen) {
			ackVaults = false;
			soleVaults = null;
		}
	});

	function track(name: string) {
		return withToast({ pending: (on) => (busy = on ? name : null) });
	}
</script>

<svelte:head>
	<title>{user.username} · Usuários · lumi · Administração</title>
</svelte:head>

<nav class="crumbs" aria-label="Trilha">
	<a href="/usuarios">Usuários</a> <Icon name="chevron" size={14} /> <span aria-current="page">{user.username}</span>
</nav>

<header class="profile">
	<Avatar name={user.displayName || user.username} size={56} />
	<div class="who">
		<h1>{user.username}</h1>
		<p class="row">
			<StatePill state={user.state} />
			{#if user.displayName}<span>{user.displayName}</span>{/if}
			<span class="muted">conta criada em {formatDate(user.createdAt)}</span>
			<span class="muted mono" title={user.id}>{shortId(user.id)}</span>
		</p>
	</div>
	<div class="row actions">
		<button class="btn" type="button" onclick={() => (passwordOpen = true)}><Icon name="key" size={16} /> Redefinir senha</button>
		{#if user.state === 'locked' || user.failedLogins > 0}
			<form method="POST" action="?/unlock" use:enhance={track('unlock')}>
				<button class="btn" type="submit" disabled={busy === 'unlock'}><Icon name="unlock" size={16} /> Desbloquear</button>
			</form>
		{/if}
		{#if user.sessions > 0}
			<button class="btn" type="button" onclick={() => (logoutOpen = true)}><Icon name="logout" size={16} /> Encerrar sessões</button>
		{/if}
		{#if user.state === 'disabled'}
			<form method="POST" action="?/enable" use:enhance={track('enable')}>
				<button class="btn" type="submit" disabled={busy === 'enable'}><Icon name="check" size={16} /> Reativar</button>
			</form>
		{:else}
			<button class="btn danger" type="button" onclick={() => (disableOpen = true)}><Icon name="ban" size={16} /> Desativar</button>
		{/if}
		<button class="btn danger solid" type="button" onclick={() => (deleteOpen = true)}><Icon name="trash" size={16} /> Apagar</button>
	</div>
</header>

{#if user.state === 'disabled'}
	<div class="banner alert"><Icon name="ban" /><p>Conta desativada {user.disabledAt ? `desde ${formatDateTime(user.disabledAt)}` : ''}: não entra e nenhuma sessão vale.</p></div>
{:else if lockedNow}
	<div class="banner warn"><Icon name="lock" /><p>Bloqueada até {formatDateTime(user.lockedUntil)} depois de {plural(user.failedLogins, 'senha errada', 'senhas erradas')} seguidas. Desbloqueie se foi a própria pessoa.</p></div>
{/if}

<div class="facts-grid">
	<div class="fact"><span class="k">Último acesso</span><span class="v" title={formatDateTime(user.lastSeenAt)}>{formatRelative(user.lastSeenAt)}</span></div>
	<div class="fact"><span class="k">Última entrada</span><span class="v" title={formatDateTime(user.lastLoginAt)}>{formatRelative(user.lastLoginAt)}</span></div>
	<div class="fact"><span class="k">Sessões ativas</span><span class="v">{formatInt(user.sessions)}</span></div>
	<div class="fact"><span class="k">Cofres</span><span class="v">{formatInt(user.vaults)} <small>dono de {formatInt(user.ownedVaults)}</small></span></div>
	<div class="fact" class:warn={user.failedLogins > 0}><span class="k">Falhas seguidas</span><span class="v">{formatInt(user.failedLogins)}</span></div>
</div>

<div class="grid-2">
	<div>
		<section class="block">
			<div class="card-head">
				<h2>Sessões</h2>
				{#if data.sessions.length > 0}<a href="/sessoes?usuario={user.id}">Abrir em Sessões</a>{/if}
			</div>
			<div class="table-card">
				{#if data.sessions.length === 0}
					<EmptyState icon="activity" title="Nenhuma sessão ativa" description="A pessoa não está conectada em nenhum aparelho." />
				{:else}
					<table class="table">
						<thead>
							<tr><th scope="col">Sessão</th><th scope="col">Último uso</th><th scope="col">Expira</th><th scope="col"><span class="sr-only">Ações</span></th></tr>
						</thead>
						<tbody>
							{#each data.sessions as s (s.id)}
								<tr>
									<td class="primary"><span class="mono" title={s.id}>{shortId(s.id)}</span> <span class="muted">desde {formatDate(s.createdAt)}</span></td>
									<td data-label="Último uso" title={formatDateTime(s.lastUsedAt)}>{formatRelative(s.lastUsedAt)}</td>
									<td data-label="Expira">{formatDate(s.expiresAt)}</td>
									<td class="actions">
										<button class="btn small danger" type="button"
											onclick={() => { revoking = { id: s.id, label: shortId(s.id) }; revokeOpen = true; }}>Encerrar</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
			{#if data.sessionsMore}<p class="hint">Mostrando as 200 mais recentes.</p>{/if}
		</section>

		<section class="block">
			<h2>Cofres</h2>
			<div class="table-card">
				{#if data.vaults.length === 0}
					<EmptyState icon="vault" title="Sem cofres" description="Não é dono nem membro de nenhum cofre." />
				{:else}
					<table class="table">
						<thead>
							<tr><th scope="col">Cofre</th><th scope="col">Papel</th><th scope="col" class="num">Notas</th><th scope="col" class="num">CRDT</th></tr>
						</thead>
						<tbody>
							{#each data.vaults as v (v.id)}
								<tr>
									<td class="primary"><a class="row-link" href="/cofres/{v.id}"><span class="mono">{v.slug}</span>{#if v.name}<span class="sub">{v.name}</span>{/if}</a></td>
									<td data-label="Papel">{#if v.owner.id === user.id}<StatePill state="owner" label="dono" />{:else}membro{/if}</td>
									<td data-label="Notas" class="num">{formatInt(v.notes)}</td>
									<td data-label="CRDT" class="num">{formatBytes(v.crdtBytes)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</section>
	</div>

	<section class="card">
		<div class="card-head">
			<h2>Atividade</h2>
			<a href="/auditoria?usuario={user.id}">Auditoria desta conta</a>
		</div>
		{#if data.activity === null}
			<p class="muted">Auditoria indisponível agora.</p>
		{:else}
			<AuditFeed entries={data.activity} empty="Nada registrado para esta conta." />
		{/if}
	</section>
</div>

<ConfirmDialog bind:open={passwordOpen} title="Redefinir a senha de {user.username}" action="?/password"
	confirmLabel="Redefinir senha" ready={passwordReady(mode, password, repeat)} quiet
	onsuccess={(d) => {
		if (typeof d?.generated === 'string') {
			generated = d.generated;
			generatedOpen = true;
		} else if (typeof d?.message === 'string') {
			toast(d.message, 'ok');
		}
	}}>
	<p>Zera as falhas e o bloqueio e encerra todas as sessões do usuário.</p>
	<PasswordChoice bind:mode bind:password bind:repeat />
</ConfirmDialog>

<SecretDialog bind:open={generatedOpen} title="Nova senha de {user.username}" secret={generated}>
	<p>Senha redefinida. Todas as sessões foram encerradas; passe esta senha temporária para a pessoa:</p>
</SecretDialog>

<ConfirmDialog bind:open={logoutOpen} title="Encerrar as sessões de {user.username}?" action="?/logoutAll" confirmLabel="Encerrar todas" danger>
	<p>{plural(user.sessions, 'sessão ativa é encerrada', 'sessões ativas são encerradas')}: cada aparelho precisa entrar de novo. A senha não muda.</p>
</ConfirmDialog>

<ConfirmDialog bind:open={disableOpen} title="Desativar {user.username}?" action="?/disable" confirmLabel="Desativar" danger>
	<p>O usuário não consegue mais entrar e todas as sessões dele são encerradas. Dá para reativar depois.</p>
</ConfirmDialog>

{#if revoking}
	<ConfirmDialog bind:open={revokeOpen} title="Encerrar a sessão {revoking.label}?" action="?/revokeSession"
		fields={{ session: revoking.id }} confirmLabel="Encerrar sessão" danger>
		<p>O aparelho dessa sessão precisa entrar de novo.</p>
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
			<div>
				<p><strong>{user.username} é dono de {plural(vaultsToDelete.length, 'cofre', 'cofres')}</strong>, que serão apagados junto, com todas as notas, membros e vínculos de federação:</p>
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
		</div>
	{/if}
</ConfirmDialog>

<style>
	.profile {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.25rem;
		margin: 0.5rem 0 1.25rem;
	}
	.who {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.who h1 {
		margin: 0 0 0.3rem;
		font-family: var(--font-mono);
	}
	.who p {
		margin: 0;
	}
	.actions {
		justify-content: flex-end;
	}
	.facts-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
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
	.fact .v small {
		font-weight: 400;
		color: var(--color-text-dim);
	}
	.fact.warn .v {
		color: var(--color-warning);
	}
	.vaults {
		margin: 0.5rem 0;
		padding-left: 1.2rem;
		color: var(--color-text);
	}
</style>
