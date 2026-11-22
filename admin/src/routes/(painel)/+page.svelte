<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import AuditFeed from '#lib/components/AuditFeed.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import StatCard from '#lib/components/StatCard.svelte';
	import {
		daysUntil,
		formatBytes,
		formatDateTime,
		formatDuration,
		formatInt,
		formatMs,
		formatRelative,
		plural
	} from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const s = $derived(data.status);
	const days = $derived(daysUntil(s.token.expiresAt, data.fetchedAt));
	const uptime = $derived(formatDuration(data.fetchedAt - Date.parse(s.startedAt)));
	const dbTone = $derived(s.dbLatencyMs < 25 ? 'ok' : s.dbLatencyMs < 250 ? 'warn' : 'alert');
	const failTone = $derived(s.loginFailures24h >= 20 ? 'alert' : s.loginFailures24h > 0 ? 'warn' : 'ok');
	const maxBytes = $derived(Math.max(1, ...(data.top ?? []).map((v) => v.crdtBytes)));
	const live = $derived(s.wsConnections + s.feedConnections);

	type Alert = { tone: 'alert' | 'warn'; text: string; href?: string; cta?: string };
	const alerts = $derived.by(() => {
		const out: Alert[] = [];
		if (s.schemaDirty) {
			out.push({ tone: 'alert', text: `O esquema do banco está sujo (versão ${s.schemaVersion}): uma migração falhou no meio. Corrija antes de qualquer outra ação.` });
		} else if (s.pendingMigrations > 0) {
			out.push({ tone: 'warn', text: `${plural(s.pendingMigrations, 'migração pendente', 'migrações pendentes')} no banco (versão atual ${s.schemaVersion}).` });
		} else if (s.pendingMigrations < 0) {
			out.push({ tone: 'warn', text: 'O servidor não conseguiu contar as migrações pendentes (diretório de migrações ausente?).' });
		}
		if (days < 7) {
			out.push({ tone: days < 1 ? 'alert' : 'warn', text: `O token “${s.token.name}” expira ${formatRelative(s.token.expiresAt)}. Crie outro no terminal antes disso.`, href: '/tokens', cta: 'Tokens' });
		}
		if (s.usersLocked > 0) {
			out.push({ tone: 'warn', text: `${plural(s.usersLocked, 'conta bloqueada', 'contas bloqueadas')} por senhas erradas.`, href: '/usuarios?estado=locked', cta: 'Ver contas' });
		}
		if (s.loginFailures24h >= 20) {
			out.push({ tone: 'alert', text: `${formatInt(s.loginFailures24h)} falhas de login nas últimas 24 h: pode ser alguém tentando adivinhar senhas.`, href: '/auditoria?acao=auth.login_failed', cta: 'Ver falhas' });
		}
		if (s.dbLatencyMs >= 250) {
			out.push({ tone: 'warn', text: `O banco está lento: ${formatMs(s.dbLatencyMs)} para uma consulta trivial.` });
		}
		return out;
	});

	let refreshing = $state(false);
	let failed = $state(false);
	const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidate('admin:overview');
			failed = false;
		} catch {
			failed = true;
		} finally {
			refreshing = false;
		}
	}

	onMount(() => {
		const tick = () => document.visibilityState === 'visible' && refresh();
		const timer = setInterval(tick, 15_000);
		document.addEventListener('visibilitychange', tick);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', tick);
		};
	});
</script>

<svelte:head>
	<title>Visão geral · lumi · Administração</title>
</svelte:head>

<PageHeader eyebrow="Servidor" title="Visão geral" subtitle="O estado deste lumi-server agora: contas, cofres, conexões e o que pede atenção.">
	{#snippet actions()}
		<span class="live" class:failed role="status" aria-live="polite">
			<span class="pulse" class:fast={refreshing} aria-hidden="true"></span>
			{failed ? 'Sem resposta' : 'Ao vivo'}
			<small>· {clock.format(data.fetchedAt)}</small>
		</span>
		<button class="btn small" type="button" onclick={refresh} disabled={refreshing}>
			<Icon name="refresh" size={15} /> Atualizar
		</button>
	{/snippet}
</PageHeader>

{#each alerts as a (a.text)}
	<div class="banner {a.tone}" role={a.tone === 'alert' ? 'alert' : undefined}>
		<Icon name="alert" size={18} />
		<p>{a.text}</p>
		{#if a.href}<a class="btn small" href={a.href}>{a.cta}</a>{/if}
	</div>
{/each}

<section class="hero" aria-labelledby="hero-title">
	<div>
		<p class="kicker">No ar há {uptime} · desde {formatDateTime(s.startedAt)}</p>
		<h2 id="hero-title">
			{plural(s.users, 'pessoa', 'pessoas')}, {plural(s.vaults, 'cofre', 'cofres')} e {plural(s.notes, 'nota', 'notas')}.
		</h2>
		<p class="sub">
			{formatBytes(s.crdtBytes)} de estado CRDT guardado no banco; {plural(live, 'conexão ao vivo', 'conexões ao vivo')} agora.
		</p>
	</div>
	<ul class="chips" aria-label="Saúde">
		<li class={dbTone}><Icon name="database" size={15} /> banco {formatMs(s.dbLatencyMs)}</li>
		<li class={s.schemaDirty ? 'alert' : s.pendingMigrations !== 0 ? 'warn' : 'ok'}>
			<Icon name="shield" size={15} /> esquema v{s.schemaVersion}{s.schemaDirty ? ' (sujo)' : ''}
		</li>
		<li><Icon name="server" size={15} /> {s.version}</li>
		<li><Icon name="info" size={15} /> {s.goVersion}</li>
	</ul>
</section>

<div class="stats">
	<StatCard label="Usuários" icon="users" value={formatInt(s.users)} href="/usuarios"
		hint={s.usersDisabled || s.usersLocked ? `${plural(s.usersDisabled, 'desativado', 'desativados')} · ${plural(s.usersLocked, 'bloqueado', 'bloqueados')}` : 'todos ativos'}
		tone={s.usersLocked > 0 ? 'warn' : 'neutral'} />
	<StatCard label="Sessões ativas" icon="activity" value={formatInt(s.sessions)} href="/sessoes" hint="{formatInt(s.logins24h)} entradas em 24 h" />
	<StatCard label="Falhas de login" icon="lock" value={formatInt(s.loginFailures24h)} href="/auditoria?acao=auth.login_failed"
		hint="últimas 24 h" tone={failTone === 'ok' ? 'neutral' : failTone} />
	<StatCard label="Cofres" icon="vault" value={formatInt(s.vaults)} href="/cofres" hint="{formatInt(s.notes)} notas" />
	<StatCard label="Armazenamento CRDT" icon="database" value={formatBytes(s.crdtBytes)} hint="snapshots e atualizações Yjs" />
	<StatCard label="Conexões ao vivo" icon="plug" value={formatInt(live)} hint="{formatInt(s.wsConnections)} editores · {formatInt(s.feedConnections)} feeds" />
	<StatCard label="Convites válidos" icon="mail" value={formatInt(s.invitesActive)} href="/convites" />
	<StatCard label="Federações ativas" icon="globe" value={formatInt(s.federations)} href="/federacoes" />
</div>

<div class="grid-2">
	<section class="card">
		<div class="card-head">
			<h2>Maiores cofres</h2>
			<a href="/cofres">Todos os cofres</a>
		</div>
		{#if data.top === null}
			<p class="muted">Lista indisponível agora.</p>
		{:else if data.top.length === 0}
			<EmptyState icon="vault" title="Nenhum cofre ainda" description="Os cofres aparecem aqui quando alguém criar o primeiro." />
		{:else}
			<ol class="bars">
				{#each data.top as v (v.id)}
					<li>
						<div class="bar-head">
							<a href="/cofres/{v.id}" class="mono">{v.slug}</a>
							<span class="muted">{formatBytes(v.crdtBytes)} · {plural(v.notes, 'nota', 'notas')}</span>
						</div>
						<div class="bar" aria-hidden="true"><span style:width="{Math.max(2, (v.crdtBytes / maxBytes) * 100)}%"></span></div>
					</li>
				{/each}
			</ol>
			{#if data.topPartial}<p class="hint">Entre os 200 primeiros cofres por identificador.</p>{/if}
		{/if}
	</section>

	<section class="card">
		<div class="card-head">
			<h2>Atividade recente</h2>
			<a href="/auditoria">Auditoria completa</a>
		</div>
		{#if data.recent === null}
			<p class="muted">Auditoria indisponível agora.</p>
		{:else}
			<AuditFeed entries={data.recent} />
		{/if}
	</section>

	{#if data.locked && data.locked.length > 0}
		<section class="card">
			<div class="card-head">
				<h2>Contas bloqueadas</h2>
				<a href="/usuarios?estado=locked">Ver todas</a>
			</div>
			<ul class="plain">
				{#each data.locked as u (u.id)}
					<li>
						<a href="/usuarios/{u.id}">{u.username}</a>
						<span class="muted">{plural(u.failedLogins, 'falha', 'falhas')} · até {formatDateTime(u.lockedUntil)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.failures && data.failures.length > 0}
		<section class="card">
			<div class="card-head">
				<h2>Últimas falhas de login</h2>
				<a href="/auditoria?acao=auth.login_failed">Ver todas</a>
			</div>
			<AuditFeed entries={data.failures} />
		</section>
	{/if}
</div>

<style>
	.live {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.25rem 0.7rem;
		border-radius: 999px;
		background: var(--soft-success);
		color: var(--color-success);
		font-size: 0.85rem;
		font-weight: 650;
	}
	.live small {
		color: var(--color-text-dim);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.live.failed {
		background: var(--soft-warning);
		color: var(--color-warning);
	}
	.pulse {
		position: relative;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
	}
	.pulse::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: currentColor;
		animation: ping 2s ease-out infinite;
	}
	.pulse.fast::after {
		animation-duration: 0.8s;
	}
	@keyframes ping {
		to {
			transform: scale(3);
			opacity: 0;
		}
	}
	.banner .btn {
		margin-left: auto;
	}
	.banner p {
		margin: 0;
		flex: 1;
	}
	.hero {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem 2rem;
		margin-bottom: 1rem;
		padding: 1.6rem 1.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background:
			radial-gradient(30rem 14rem at 90% 0%, var(--hero-glow), transparent 70%),
			linear-gradient(160deg, var(--color-surface-2), var(--color-surface));
		box-shadow: var(--shadow-1);
	}
	.kicker {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-accent);
	}
	.hero h2 {
		margin: 0.4rem 0 0;
		max-width: 30ch;
		font-size: clamp(1.3rem, 1rem + 1.2vw, 1.9rem);
		letter-spacing: -0.02em;
	}
	.sub {
		margin: 0.4rem 0 0;
		color: var(--color-text-dim);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chips li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-background);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--color-text-2);
	}
	.chips li.ok {
		color: var(--color-success);
		border-color: color-mix(in srgb, var(--color-success) 35%, transparent);
	}
	.chips li.warn {
		color: var(--color-warning);
		border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
	}
	.chips li.alert {
		color: var(--color-error);
		border-color: color-mix(in srgb, var(--color-error) 40%, transparent);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.bars {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.bar-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.25rem 1rem;
		margin-bottom: 0.3rem;
		font-size: 0.88rem;
	}
	.bar {
		height: 6px;
		border-radius: 999px;
		background: var(--color-selected-bg);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--color-primary), var(--color-secondary));
	}
	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.plain li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.25rem 1rem;
		padding: 0.45rem 0;
	}
	.plain li + li {
		border-top: 1px solid var(--color-separator);
	}
	@media (max-width: 480px) {
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.hero {
			padding: 1.2rem;
		}
	}
</style>
