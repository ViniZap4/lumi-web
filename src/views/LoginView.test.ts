// @vitest-environment jsdom
//
// Login: a locked account (HTTP 423 account_locked with retry_after,
// returned only when the password was right) shows a pt-BR message with
// the minutes left. Real auth/api code; only the network is stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import LoginView from './LoginView.svelte';
import { auth, describeError, lockedMessage } from '../lib/auth.svelte.ts';
import { accounts } from '../lib/accounts.svelte.ts';
import { ApiError } from '../lib/types.ts';

const S = 'https://lumi.work.com';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let target: HTMLElement;
let cmp: Record<string, any> | null = null;
let loginReply: () => Response;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
}

function fill(id: string, value: string): void {
  const el = target.querySelector<HTMLInputElement>(`#${id}`)!;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(async () => {
  for (const a of [...accounts.list]) await accounts.forget(a.key);
  auth.lastError = null;
  loginReply = () => json(423, { error: 'account_locked', retry_after: 600 });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === 'POST' && url === `${S}/api/auth/login`) return loginReply();
    return json(404, { error: 'not_found' });
  });
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target.remove();
  vi.unstubAllGlobals();
});

describe('account_locked (423)', () => {
  it('formats the minutes left (rounded up, at least 1)', () => {
    expect(lockedMessage(600)).toBe('Conta bloqueada — tente de novo em 10 min');
    expect(lockedMessage(61)).toBe('Conta bloqueada — tente de novo em 2 min');
    expect(lockedMessage(5)).toBe('Conta bloqueada — tente de novo em 1 min');
    expect(lockedMessage(undefined)).toBe('Conta bloqueada — tente de novo mais tarde.');
    expect(describeError(new ApiError(423, { error: 'account_locked', retry_after: 900 }))).toBe('Conta bloqueada — tente de novo em 15 min');
    // A malformed retry_after never prints NaN.
    expect(describeError(new ApiError(423, { error: 'account_locked', retry_after: 'x' as unknown as number }))).toBe('Conta bloqueada — tente de novo mais tarde.');
  });

  it('LoginView shows "Conta bloqueada — tente de novo em N min" and adds no account', async () => {
    cmp = mount(LoginView, { target, props: { presetServer: S } });
    await settle();
    fill('lumi-username', 'ana');
    fill('lumi-password', 'right-password');
    target.querySelector<HTMLFormElement>('form.login-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const alert = [...target.querySelectorAll('[role="alert"]')].map((e) => e.textContent?.trim());
    expect(alert).toContain('Conta bloqueada — tente de novo em 10 min');
    expect(accounts.list).toHaveLength(0);
  });

  it('a wrong password stays the generic message', async () => {
    loginReply = () => json(401, { error: 'invalid_credentials' });
    cmp = mount(LoginView, { target, props: { presetServer: S } });
    await settle();
    fill('lumi-username', 'ana');
    fill('lumi-password', 'nope');
    target.querySelector<HTMLFormElement>('form.login-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(target.textContent).toContain('Usuário ou senha inválidos.');
    expect(target.textContent).not.toContain('Conta bloqueada');
  });
});
