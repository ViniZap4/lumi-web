// App-shell service worker: build-time generation + registration.
import { describe, it, expect, vi } from 'vitest';
import template from './sw-template.js?raw';
import { precacheList, swVersion, renderServiceWorker } from './sw-build.ts';
import { registerServiceWorker } from '../lib/sw-register.ts';

describe('precache list', () => {
  it('holds the shell and every built asset, never maps or the worker itself', () => {
    const list = precacheList(['index.html', 'assets/index-abc.js', 'assets/index-abc.js.map', 'assets/NoteEditor-x.js', 'assets/a.css', 'sw.js']);
    expect(list).toEqual(['/assets/NoteEditor-x.js', '/assets/a.css', '/assets/index-abc.js', '/index.html', '/vite.svg']);
  });

  it('the version follows the build content', () => {
    const a = swVersion(['/a.js'], '<html>1');
    expect(swVersion(['/a.js'], '<html>1')).toBe(a);
    expect(swVersion(['/b.js'], '<html>1')).not.toBe(a);
    expect(swVersion(['/a.js'], '<html>2')).not.toBe(a);
  });

  it('renders a parseable worker with the list injected and no placeholders left', () => {
    const out = renderServiceWorker(template, ['/index.html', '/assets/x.js'], 'v123');
    expect(out).not.toContain('__LUMI_SW_');
    expect(out).not.toContain('@ts-nocheck');
    expect(out).toContain('const PRECACHE = ["/index.html","/assets/x.js"]');
    expect(() => new Function(out)).not.toThrow(); // syntax check only
  });

  it('never intercepts API, cross-origin, non-GET or authenticated requests', () => {
    expect(template).toMatch(/req\.method !== 'GET'\) return/);
    expect(template).toMatch(/url\.origin !== self\.location\.origin\) return/);
    expect(template).toMatch(/startsWith\('\/api\/'\)\) return/);
    expect(template).toMatch(/x-lumi-token/);
    expect(template).not.toMatch(/https?:\/\//); // no CDN / external URL
  });
});

describe('registerServiceWorker', () => {
  it('does nothing outside production builds (dev server, tests)', async () => {
    const register = vi.fn(async () => ({}));
    expect(await registerServiceWorker({ prod: false, navigator: { serviceWorker: { register } }, secure: true })).toBe(false);
    expect(register).not.toHaveBeenCalled();
    // The default env in vitest is not PROD either.
    expect(await registerServiceWorker()).toBe(false);
  });

  it('registers /sw.js at the root scope in production', async () => {
    const register = vi.fn(async () => ({}));
    expect(await registerServiceWorker({ prod: true, navigator: { serviceWorker: { register } }, secure: true })).toBe(true);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('is a silent no-op without support, on insecure origins, or when registration fails', async () => {
    expect(await registerServiceWorker({ prod: true, navigator: {}, secure: true })).toBe(false);
    const register = vi.fn(async () => ({}));
    expect(await registerServiceWorker({ prod: true, navigator: { serviceWorker: { register } }, secure: false })).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn(async () => { throw new Error('blocked'); });
    expect(await registerServiceWorker({ prod: true, navigator: { serviceWorker: { register: failing } }, secure: true })).toBe(false);
    warn.mockRestore();
  });
});
