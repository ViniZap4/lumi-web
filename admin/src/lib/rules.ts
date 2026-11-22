/**
 * The registration rules of lumi-server (internal/auth: canonicaliseUsername, ValidatePassword), checked before a
 * call so the common mistakes get a clear message. The server stays the authority and checks again.
 */

export function normalizeUsername(raw: string): string {
	return raw.trim().toLowerCase();
}

/** Null when it fits, else the reason in Portuguese. */
export function usernameProblem(raw: string): string | null {
	const u = normalizeUsername(raw);
	if (u.length < 3 || u.length > 32) return 'O nome de usuário precisa ter de 3 a 32 caracteres.';
	if (!/^[a-z0-9_-]+$/.test(u)) return 'Use só letras minúsculas, números, _ e -.';
	if (/^[-_]|[-_]$/.test(u)) return 'O nome não pode começar nem terminar com _ ou -.';
	return null;
}

export function passwordProblem(password: string): string | null {
	const bytes = new TextEncoder().encode(password).length;
	if (bytes > 72) return 'A senha passa de 72 bytes.';
	const chars = [...password];
	if (chars.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
	if (chars.every((c) => /\p{Nd}/u.test(c))) return 'A senha não pode ter só dígitos.';
	if (chars.every((c) => /\p{L}/u.test(c)) && chars.length < 10) {
		return 'Uma senha só com letras precisa de pelo menos 10 caracteres.';
	}
	return null;
}

export function displayNameProblem(name: string): string | null {
	return [...name].length > 80 ? 'O nome de exibição tem no máximo 80 caracteres.' : null;
}

/**
 * The typed confirmation of a destructive action (ADR 0037 of porvia): the exact name of the target, ignoring
 * surrounding spaces. Case matters, except for usernames and slugs, which are lower-case anyway.
 */
export function confirmed(typed: string, expected: string): boolean {
	return expected !== '' && typed.trim() === expected;
}

/** Whether a password form (PasswordChoice) can be sent: generating always can, typing needs a valid matching pair. */
export function passwordReady(mode: string, password: string, repeat: string): boolean {
	return mode === 'gerar' || (passwordProblem(password) === null && password === repeat);
}
