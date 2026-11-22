// Server URL normalisation (SPEC-LIVROS §2.1).
//
// `server_url` = scheme + host in lowercase, no default port, no
// trailing slash, no query/fragment. A base path is allowed
// (`https://x.com/lumi`). Plain `http://` is only accepted for
// localhost, private IPs and `*.local` — and the UI keeps a visible
// warning for it (see `isInsecure`).
//
// The normalised string is half of an account's identity
// (`server_url`, `username`), so every place that builds an account
// key MUST go through `normalizeServerUrl`.

export class ServerUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerUrlError';
  }
}

/** True for hosts where plain http is tolerated (§2.1). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true;
  if (h === '::1') return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Normalise user input into a canonical `server_url`. Input without a
 * scheme is treated as https. Throws ServerUrlError with a pt-BR
 * message the form can show verbatim.
 */
export function normalizeServerUrl(input: string): string {
  let raw = (input ?? '').trim();
  if (!raw) throw new ServerUrlError('Informe a URL do servidor.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ServerUrlError('URL inválida.');
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'http:') {
    throw new ServerUrlError('Use uma URL http(s).');
  }
  if (u.username || u.password) {
    throw new ServerUrlError('A URL não pode conter usuário ou senha.');
  }
  if (!u.hostname) throw new ServerUrlError('URL sem host.');
  if (scheme === 'http:' && !isPrivateHost(u.hostname)) {
    throw new ServerUrlError(
      'http:// só é aceito para localhost, IPs privados e *.local. Use https://.',
    );
  }
  // URL already lowercases scheme/host and drops default ports.
  const path = u.pathname.replace(/\/+$/, '');
  return `${scheme}//${u.host.toLowerCase()}${path}`;
}

/** True when the server is reached over plain http (UI warning). */
export function isInsecure(serverUrl: string): boolean {
  return serverUrl.startsWith('http://');
}

/** WebSocket base for a normalised server URL (http→ws, https→wss). */
export function wsBase(serverUrl: string): string {
  if (serverUrl.startsWith('https://')) return 'wss://' + serverUrl.slice('https://'.length);
  if (serverUrl.startsWith('http://')) return 'ws://' + serverUrl.slice('http://'.length);
  return serverUrl;
}

/** Short label for UI: host[:port][/path], no scheme. */
export function serverLabel(serverUrl: string): string {
  return serverUrl.replace(/^https?:\/\//, '');
}

/** Origin (scheme://host[:port]) of a normalised server URL. */
export function serverOrigin(serverUrl: string): string {
  try {
    return new URL(serverUrl).origin;
  } catch {
    return serverUrl;
  }
}
