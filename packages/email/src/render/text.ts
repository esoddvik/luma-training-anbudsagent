/**
 * Plain-text primitives.
 *
 * The text part is a real alternative, not a stripped copy: spec section 4.1
 * says the email has to be useful with everything decorative removed, and the
 * plain-text part is the strictest reading of that. It carries the same
 * sections, in the same order, with the same links.
 *
 * Every URL is printed bare, on its own line, because the link-parity test
 * extracts URLs from both parts and asserts the two sets are equal.
 */

export const TEXT_WIDTH = 72;

export function rule(character = '-'): string {
  return character.repeat(TEXT_WIDTH);
}

/** A section heading: the text, then an underline of the same length. */
export function underlined(text: string, character = '-'): string {
  return `${text}\n${character.repeat(Math.min(text.length, TEXT_WIDTH))}`;
}

/** A labelled link, rendered as two lines so the URL survives copy and paste. */
export function labelledLink(label: string, url: string): string {
  return `${label}:\n${url}`;
}

export function bullet(text: string): string {
  return `- ${text}`;
}

export function definition(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** Joins blocks with a blank line, dropping empties. */
export function blocks(...parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join('\n\n');
}

/**
 * Hard-wraps a paragraph. Long, unbroken tokens - URLs above all - are left
 * intact rather than split, because a broken URL is worse than a long line.
 */
export function wrap(text: string, width = TEXT_WIDTH): string {
  const lines: string[] = [];
  for (const sourceLine of text.split('\n')) {
    let current = '';
    for (const word of sourceLine.split(' ')) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= width) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.join('\n');
}
