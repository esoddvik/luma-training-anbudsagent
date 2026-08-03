import { describe, expect, it } from 'vitest';
import { allowedHostsFrom, isHostAllowed } from './host-allowlist.js';

const PUBLIC_URL = 'https://mcp.luma-training.com';

describe('allowedHostsFrom', () => {
  it('always admits the canonical MCP_URL host, so a correct deployment needs no extra config', () => {
    expect(allowedHostsFrom(PUBLIC_URL).has('mcp.luma-training.com')).toBe(true);
  });

  it('keeps an explicit port, because a dev server on localhost:3002 is a different host', () => {
    const allowed = allowedHostsFrom('http://localhost:3002');
    expect(allowed.has('localhost:3002')).toBe(true);
    expect(allowed.has('localhost')).toBe(false);
  });

  it('admits platform-added domains passed alongside the canonical one', () => {
    const allowed = allowedHostsFrom(PUBLIC_URL, ['luma-mcp.up.railway.app']);
    expect(allowed.has('mcp.luma-training.com')).toBe(true);
    expect(allowed.has('luma-mcp.up.railway.app')).toBe(true);
  });

  it('ignores blank entries so a trailing comma in the variable is not a host', () => {
    const allowed = allowedHostsFrom(PUBLIC_URL, ['', '   ']);
    expect(allowed.size).toBe(1);
  });
});

describe('isHostAllowed', () => {
  const allowed = allowedHostsFrom(PUBLIC_URL);

  it('admits the configured host', () => {
    expect(isHostAllowed('mcp.luma-training.com', allowed)).toBe(true);
  });

  it('admits it case-insensitively, since Host casing is not significant', () => {
    expect(isHostAllowed('MCP.Luma-Training.com', allowed)).toBe(true);
  });

  it('admits it with the port the scheme already implies', () => {
    expect(isHostAllowed('mcp.luma-training.com:443', allowed)).toBe(true);
  });

  it('rejects a non-default port on an otherwise allowed name', () => {
    expect(isHostAllowed('mcp.luma-training.com:8080', allowed)).toBe(false);
  });

  // The attack this exists for. The attacker controls DNS for their own name,
  // repoints it here, and the browser sends their hostname in Host.
  it('rejects an attacker-controlled hostname that resolves to this server', () => {
    expect(isHostAllowed('rebind.attacker.example', allowed)).toBe(false);
  });

  it('rejects a suffix that merely ends with the allowed name', () => {
    expect(isHostAllowed('evil-mcp.luma-training.com.attacker.example', allowed)).toBe(false);
  });

  // This is the case that separates an exact match from `endsWith`, and it is
  // here because it was missing: replacing the set lookup with a suffix test
  // passed every other assertion in this file. Not exploitable for the current
  // value, since anything ending in `.luma-training.com` is ours anyway — but
  // one short entry in MCP_ALLOWED_HOSTS, say a bare platform domain, and
  // `nottheirdomain.example` would walk straight in.
  it('rejects a name ending with the allowed host but carrying a longer label', () => {
    expect(isHostAllowed('evilmcp.luma-training.com', allowed)).toBe(false);
  });

  it('rejects a subdomain of an allowed host, which is a different server', () => {
    expect(isHostAllowed('inner.mcp.luma-training.com', allowed)).toBe(false);
  });

  it('rejects a prefix that merely starts with the allowed name', () => {
    expect(isHostAllowed('mcp.luma-training.com.attacker.example', allowed)).toBe(false);
  });

  it('rejects localhost, which is what a rebinding payload usually aims at', () => {
    expect(isHostAllowed('localhost', allowed)).toBe(false);
    expect(isHostAllowed('127.0.0.1', allowed)).toBe(false);
  });

  it('rejects an absent Host header rather than treating it as unremarkable', () => {
    expect(isHostAllowed(undefined, allowed)).toBe(false);
  });

  it('rejects an empty Host header', () => {
    expect(isHostAllowed('', allowed)).toBe(false);
    expect(isHostAllowed('   ', allowed)).toBe(false);
  });

  // Node surfaces a repeated header as an array. Choosing one of two
  // conflicting values is how a parser difference turns into a bypass, so
  // neither is chosen.
  it('rejects a duplicated Host header instead of picking one', () => {
    expect(isHostAllowed(['mcp.luma-training.com', 'attacker.example'], allowed)).toBe(false);
    expect(isHostAllowed(['attacker.example', 'mcp.luma-training.com'], allowed)).toBe(false);
  });
});
