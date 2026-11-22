import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ConfirmDialog from './ConfirmDialog.svelte';

// jsdom has no showModal/close.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
	this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
	this.removeAttribute('open');
	this.dispatchEvent(new Event('close'));
};

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

describe('ConfirmDialog', () => {
	it('keeps the destructive button disabled until the exact target is typed', () => {
		app = mount(ConfirmDialog, {
			target: document.body,
			props: { open: true, title: 'Apagar ana?', action: '?/delete', confirmLabel: 'Apagar', danger: true, requireText: 'ana' }
		});
		flushSync();
		const dialog = document.querySelector('dialog')!;
		expect(dialog.hasAttribute('open')).toBe(true);
		expect(dialog.getAttribute('role')).toBe('alertdialog');
		const submit = dialog.querySelector<HTMLButtonElement>('button[type=submit]')!;
		const input = dialog.querySelector<HTMLInputElement>('input[name=confirm]')!;
		expect(submit.disabled).toBe(true);
		type(input, 'Ana');
		expect(submit.disabled).toBe(true);
		type(input, ' ana ');
		expect(submit.disabled).toBe(false);
	});

	it('respects an extra gate from the caller', () => {
		app = mount(ConfirmDialog, {
			target: document.body,
			props: { open: true, title: 'x', action: '?/x', confirmLabel: 'Ok', ready: false }
		});
		flushSync();
		expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
	});
});
