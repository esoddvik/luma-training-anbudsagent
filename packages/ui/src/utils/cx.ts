export type ClassValue = string | false | null | undefined;

/**
 * Joins class names, dropping falsy entries. Returns `undefined` when nothing
 * is left so React omits the attribute entirely instead of rendering `class=""`.
 */
export function cx(...values: readonly ClassValue[]): string | undefined {
  const parts: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) parts.push(trimmed);
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}
