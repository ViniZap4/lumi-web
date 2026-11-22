// No 0/O, 1/l/I: the operator reads this aloud or types it into a message.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A temporary password for a reset or a new account: 4 groups of 5 from a 57-symbol alphabet (~116 bits), with a
 * digit and a letter guaranteed, so it always fits the server's rules. Rejection sampling keeps it unbiased. It is
 * shown once in the action result (no-store) and never logged or kept by the panel.
 */
export function generatePassword(groups = 4, size = 5): string {
	for (;;) {
		const chars: string[] = [];
		const limit = 256 - (256 % ALPHABET.length);
		while (chars.length < groups * size) {
			for (const b of crypto.getRandomValues(new Uint8Array(64))) {
				if (b < limit && chars.length < groups * size) chars.push(ALPHABET[b % ALPHABET.length]);
			}
		}
		const pw = chars.join('');
		if (/\d/.test(pw) && /[a-zA-Z]/.test(pw)) {
			const out: string[] = [];
			for (let i = 0; i < pw.length; i += size) out.push(pw.slice(i, i + size));
			return out.join('-');
		}
	}
}
