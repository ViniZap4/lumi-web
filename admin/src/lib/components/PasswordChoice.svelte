<script lang="ts">
	import { passwordProblem } from '../rules.ts';

	type Props = { mode?: 'gerar' | 'definir'; password?: string; repeat?: string };
	let { mode = $bindable('gerar'), password = $bindable(''), repeat = $bindable('') }: Props = $props();

	const uid = $props.id();
	const problem = $derived(mode === 'definir' && password ? passwordProblem(password) : null);
</script>

<fieldset class="choice">
	<legend>Senha</legend>
	<label class="opt">
		<input type="radio" name="mode" value="gerar" bind:group={mode} />
		<span><strong>Gerar uma senha temporária</strong><small>O painel sorteia uma senha forte e mostra uma única vez.</small></span>
	</label>
	<label class="opt">
		<input type="radio" name="mode" value="definir" bind:group={mode} />
		<span><strong>Definir agora</strong><small>Você digita a senha.</small></span>
	</label>
</fieldset>

{#if mode === 'definir'}
	<div class="field">
		<label for="{uid}-pw">Senha</label>
		<input id="{uid}-pw" name="password" type="password" autocomplete="new-password" required minlength="8" bind:value={password}
			aria-describedby="{uid}-hint" aria-invalid={problem ? 'true' : undefined} />
		<span class="hint" id="{uid}-hint">{problem ?? '8 a 72 bytes, não só dígitos; só letras exige 10.'}</span>
	</div>
	<div class="field">
		<label for="{uid}-rp">Repita a senha</label>
		<input id="{uid}-rp" name="password_repeat" type="password" autocomplete="new-password" required bind:value={repeat}
			aria-invalid={repeat && repeat !== password ? 'true' : undefined} />
		{#if repeat && password !== repeat}<span class="hint" role="status">As senhas não conferem.</span>{/if}
	</div>
{/if}

<style>
	.choice {
		display: grid;
		gap: 0.4rem;
		margin: 0 0 0.9rem;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: 0.35rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text-2);
	}
	.opt {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		cursor: pointer;
	}
	.opt:has(input:checked) {
		border-color: var(--color-primary);
		background: var(--soft-primary);
	}
	.opt input {
		margin-top: 0.2rem;
	}
	.opt span {
		display: flex;
		flex-direction: column;
	}
	small {
		color: var(--color-text-dim);
	}
</style>
