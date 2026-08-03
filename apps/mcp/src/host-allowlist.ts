/**
 * Host allowlist for the MCP endpoint (spec §40, "host allowlist for MCP").
 *
 * A Streamable HTTP MCP server is reachable by any client that can make an
 * HTTP request, including a browser executing a page the user did not choose
 * to trust. DNS rebinding is the attack this closes: an attacker's domain
 * resolves first to their own address and then, after the page has loaded, to
 * the address this server listens on. The browser considers it the same origin
 * throughout, so same-origin policy raises no objection, and the request
 * arrives here carrying the attacker's hostname in `Host`.
 *
 * Bearer auth is the stronger control and is unchanged — a rebound request
 * carries no token. This is defence in depth, and it is cheap: comparing one
 * header against a set costs nothing and runs before any database work.
 *
 * **Scope is deliberately the MCP path only.** `/health` and `/ready` are left
 * open because Railway probes them, and the hostname a platform probe uses is
 * not something this service controls — enforcing there would trade a remote
 * attack for a restart loop.
 */

/**
 * Lowercases and drops a port that the scheme implies anyway, so that
 * `Example.com:443` and `example.com` compare equal.
 *
 * Only the two default ports are stripped. A request for `example.com:8080`
 * against an allowlist holding `example.com` stays a mismatch, which is the
 * intent: the port is part of the identity unless the scheme already fixed it.
 */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:443$/, '').replace(/:80$/, '');
}

/**
 * The hosts this server answers MCP requests on.
 *
 * `MCP_URL` is the canonical public address and is always included, so a
 * correct deployment needs no extra configuration. `extra` exists for the
 * hosts a platform adds without asking: Railway serves every service on a
 * generated `*.up.railway.app` domain alongside any custom one, and a client
 * pointed at the generated domain is legitimate.
 */
export function allowedHostsFrom(
  mcpUrl: string,
  extra: readonly string[] = [],
): ReadonlySet<string> {
  const hosts = new Set<string>();
  hosts.add(normalizeHost(new URL(mcpUrl).host));
  for (const entry of extra) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) hosts.add(normalizeHost(trimmed));
  }
  return hosts;
}

/**
 * Whether a request's `Host` header names a host this server serves.
 *
 * An absent header is rejected rather than waved through. HTTP/1.1 requires
 * one, so its absence means either a pre-1.1 client, which has no business
 * here, or something constructing requests by hand. Node presents a repeated
 * header as an array; that is likewise rejected, because picking one of two
 * conflicting values is how a parser difference becomes a bypass.
 */
export function isHostAllowed(
  header: string | string[] | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (typeof header !== 'string') return false;
  const host = normalizeHost(header);
  if (host.length === 0) return false;
  return allowed.has(host);
}
