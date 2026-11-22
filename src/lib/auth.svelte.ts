// Auth facade over the multi-account registry (SPEC-LIVROS W1).
//
// Components keep talking to `auth` (sign in, sign up, invite flows,
// current user), but there is no single global session any more:
//   - `auth.user` is the user of the ACTIVE BOOK's account (what
//     ownership/capability checks in vault views must compare against);
//   - sign-in/up take the server URL and the "Lembrar neste aparelho"
//     flag and ADD an account; other accounts are untouched;
//   - session loss is per account (`handleSessionLost(key)`).

import { ApiError, type SessionResponse, type SessionUser } from './types.ts';
import { createClient, type RegisterInput } from './api.ts';
import { accounts } from './accounts.svelte.ts';
import { books } from './books.svelte.ts';
import { normalizeServerUrl } from './serverurl.ts';
import type { ServerInfo } from './types.ts';

export interface SignInInput {
  serverUrl: string;
  username: string;
  password: string;
  remember: boolean;
  publicKey?: string | null;
}

export interface SignUpInput extends RegisterInput {
  serverUrl: string;
  remember: boolean;
  publicKey?: string | null;
}

export type ProbeResult =
  | { ok: true; serverUrl: string; info: ServerInfo | null; duplicateOf: string | null; warning: string | null }
  | { ok: false; error: string };

class AuthStore {
  initialising = $state(true);
  lastError = $state<string | null>(null);

  /** User of the active book's account (null when signed out). */
  user = $derived.by<SessionUser | null>(() => {
    const k = books.activeAccountKey();
    return k ? accounts.user(k) : null;
  });

  /** True once at least one account exists on this device. Accounts
   *  that need a new sign-in still count: their books stay listed with
   *  "Precisa entrar". */
  authenticated = $derived(accounts.list.length > 0);

  /** Active book's account key. */
  get accountKey(): string | null {
    return books.activeAccountKey();
  }

  /** REST 401 / editor auth failure on `key` (default: active account).
   *  Only that account is affected. */
  handleSessionLost(key: string | null = this.accountKey): void {
    if (!key) return;
    accounts.markNeedsLogin(key, 'sessão expirada');
    this.lastError = 'Sua sessão expirou. Entre novamente.';
  }

  /**
   * "Adicionar servidor" step 2 (§5): normalise the URL, refuse mixed
   * content, read GET /api/info and detect a server already registered
   * under another URL (same public_key). Old servers without /api/info
   * are accepted (404) — they just lack the feed.
   */
  async probeServer(input: string): Promise<ProbeResult> {
    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl(input);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const pageOrigin = typeof location !== 'undefined' ? location.origin : '';
    if (pageOrigin.startsWith('https:') && serverUrl.startsWith('http:')) {
      return {
        ok: false,
        error:
          'Esta página é HTTPS e o navegador bloqueia acesso a servidores http:// (conteúdo misto). Use https:// no servidor.',
      };
    }
    try {
      const info = await accounts.anonymous(serverUrl).info();
      const dup = accounts.findByPublicKey(info?.public_key, serverUrl);
      return {
        ok: true,
        serverUrl: dup ? dup.server_url : serverUrl,
        info,
        duplicateOf: dup ? dup.server_url : null,
        warning: dup
          ? `Este é o mesmo servidor já cadastrado como ${dup.server_url}; vamos usar essa URL.`
          : null,
      };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        return { ok: true, serverUrl, info: null, duplicateOf: null, warning: null };
      }
      if (e instanceof ApiError && e.status === 0) {
        const origin = pageOrigin || 'esta página';
        return {
          ok: false,
          error: `Não foi possível falar com o servidor. Se ele estiver no ar, ele não aceita acesso a partir de ${origin}: peça ao administrador para incluir ${origin} em LUMI_ALLOWED_ORIGINS.`,
        };
      }
      return { ok: false, error: describeError(e) };
    }
  }

  async signIn(input: SignInInput): Promise<string> {
    this.lastError = null;
    try {
      const serverUrl = normalizeServerUrl(input.serverUrl);
      const sess = await accounts.anonymous(serverUrl).login(input.username, input.password);
      return await this.acceptSession(serverUrl, sess, input.remember, input.publicKey);
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  async signUp(input: SignUpInput): Promise<string> {
    this.lastError = null;
    try {
      const { serverUrl: raw, remember, publicKey, ...body } = input;
      const serverUrl = normalizeServerUrl(raw);
      const sess = await accounts.anonymous(serverUrl).register(body);
      return await this.acceptSession(serverUrl, sess, remember, publicKey);
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  /** New account through an invite link; returns the joined vault id. */
  async signUpViaInvite(
    inviteToken: string,
    input: SignUpInput,
  ): Promise<{ vaultID: string; accountKey: string }> {
    this.lastError = null;
    try {
      const { serverUrl: raw, remember, publicKey, ...body } = input;
      const serverUrl = normalizeServerUrl(raw);
      const resp = await accounts.anonymous(serverUrl).acceptInviteWithSignup(inviteToken, body);
      // One-off call with the fresh token before the account exists.
      const me = await fetchMe(serverUrl, resp.token);
      const key = await this.acceptSession(
        serverUrl,
        { token: resp.token, expires_at: resp.expires_at, user: me },
        remember,
        publicKey,
      );
      return { vaultID: resp.vault.id, accountKey: key };
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  /** Accept an invite as an existing account (default: active). */
  async acceptInvite(inviteToken: string, key: string | null = this.accountKey): Promise<{ vaultID: string }> {
    this.lastError = null;
    try {
      if (!key) throw new ApiError(0, { error: 'no_account', detail: 'Entre numa conta primeiro.' });
      const resp = await accounts.client(key).acceptInviteAsCurrentUser(inviteToken);
      await books.refreshAccount(key);
      return { vaultID: resp.vault.id };
    } catch (e) {
      this.lastError = describeError(e);
      throw e;
    }
  }

  /** "Sair deste aparelho" for one account (default: active). Its
   *  books leave the list too. */
  async signOut(key: string | null = this.accountKey): Promise<void> {
    if (!key) return;
    await accounts.signOut(key);
  }

  private async acceptSession(
    serverUrl: string,
    sess: SessionResponse,
    remember: boolean,
    publicKey?: string | null,
  ): Promise<string> {
    const acct = await accounts.add(
      {
        server_url: serverUrl,
        username: sess.user.username,
        user_id: sess.user.id,
        display_name: sess.user.display_name,
        added_at: new Date().toISOString(),
        expires_at: sess.expires_at ?? null,
        remember,
        public_key: publicKey ?? null,
      },
      sess.token,
    );
    await books.refreshAccount(acct.key, true);
    if (!books.active) {
      const first = books.ordered.find((b) => books.accountKeyOf(b) === acct.key);
      if (first) books.setActive(first.id);
    }
    return acct.key;
  }
}

function fetchMe(serverUrl: string, token: string): Promise<SessionUser> {
  return createClient(serverUrl, () => token).me();
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        return 'Usuário ou senha inválidos.';
      case 'registration_closed':
        return 'Este servidor não aceita cadastros. Peça um convite a um administrador.';
      case 'consent_required':
        return 'Você precisa aceitar os Termos de Uso e a Política de Privacidade.';
      case 'username_taken':
        return 'Esse nome de usuário já está em uso.';
      case 'validation_failed':
        return err.detail ?? 'O formulário tem campos inválidos.';
      case 'rate_limited':
        return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
      case 'token_expired':
      case 'unauthorized':
        return 'Sua sessão expirou. Entre novamente.';
      case 'invite_expired':
        return 'Este convite expirou. Peça um novo.';
      case 'invite_revoked':
        return 'Este convite foi revogado.';
      case 'invite_exhausted':
        return 'Este convite já foi usado.';
      case 'missing_token':
      case 'token_invalid':
        return 'Este link de convite é inválido.';
      case 'network_error':
        return 'Não foi possível falar com o servidor.';
      default:
        return err.detail ?? err.code;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido.';
}

export const auth = new AuthStore();
