import { describe, it, expect } from 'vitest';
import { normalizeServerUrl, isPrivateHost, wsBase, ServerUrlError } from './serverurl.ts';

describe('normalizeServerUrl (§2.1)', () => {
  it.each([
    ['https://Lumi.Work.COM/', 'https://lumi.work.com'],
    ['lumi.work.com', 'https://lumi.work.com'],
    ['https://lumi.work.com:443', 'https://lumi.work.com'],
    ['https://lumi.work.com:8443/', 'https://lumi.work.com:8443'],
    ['https://x.com/lumi/?q=1#frag', 'https://x.com/lumi'],
    ['http://localhost:8080/', 'http://localhost:8080'],
    ['http://192.168.0.10:8080', 'http://192.168.0.10:8080'],
    ['http://nas.local', 'http://nas.local'],
    ['http://100.101.1.2', 'http://100.101.1.2'],
  ])('%s → %s', (input, out) => {
    expect(normalizeServerUrl(input)).toBe(out);
  });

  it.each(['http://example.com', 'ftp://x.com', 'https://user:pw@x.com', '', 'https://'])('rejects %s', (input) => {
    expect(() => normalizeServerUrl(input)).toThrow(ServerUrlError);
  });

  it('private hosts and ws base', () => {
    expect(isPrivateHost('10.0.0.1')).toBe(true);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(wsBase('https://x.com/lumi')).toBe('wss://x.com/lumi');
    expect(wsBase('http://localhost:8080')).toBe('ws://localhost:8080');
  });
});
