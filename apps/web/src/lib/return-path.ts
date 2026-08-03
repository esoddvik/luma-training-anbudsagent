/**
 * Where to send a user back to after signing in.
 *
 * The login page takes the destination as a `retur` query parameter, which
 * makes it attacker-controlled input. Only a same-origin absolute path is
 * accepted; anything that could resolve to another host is dropped rather than
 * repaired, because a login page that will forward to an arbitrary URL turns
 * the service's own domain into a credible phishing hop.
 */
export function safeReturnPath(candidate: string | null | undefined): string | undefined {
  if (!candidate || candidate.length === 0) return undefined;
  if (!candidate.startsWith('/')) return undefined;
  // `//evil.example` and `/\evil.example` are protocol-relative URLs that a
  // naive "starts with a slash" check lets straight through.
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return undefined;
  // A backslash is normalised to a forward slash by some browsers, so treat it
  // as if it were one everywhere in the path.
  if (candidate.includes('\\')) return undefined;
  return candidate;
}

/** The login URL for a protected page. */
export function loginPath(returnPath?: string | null): string {
  const safe = safeReturnPath(returnPath);
  return safe === undefined ? '/logg-inn' : `/logg-inn?retur=${encodeURIComponent(safe)}`;
}
