/**
 * The little that a legal document body is allowed to be (spec section 19).
 *
 * The bodies in `@luma/content` are Markdown, and this app has no Markdown
 * renderer and no dependency for one. Rather than adding a library to render
 * two constructs, this parses the two: `## ` headings and blank-line-separated
 * paragraphs.
 *
 * **The risk in a partial Markdown parser is that it is silently partial.**
 * When Luma supplies reviewed terms containing a bulleted list, a renderer
 * like this would print `- Tjenestens omfang` as a paragraph with a stray
 * hyphen, on the page where being wrong matters most, and nothing would
 * complain. So the supported set is closed and `unsupportedLegalMarkup` names
 * anything outside it — `legal-body.test.ts` runs it over every committed body
 * and fails, which turns "the renderer cannot do this yet" into a red test at
 * the moment the text arrives rather than a bad page after it ships.
 */

export type LegalBlock =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string };

/** Markdown this parser does not handle, in the order it appears. */
export function unsupportedLegalMarkup(body: string): readonly string[] {
  const found: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('## ')) continue;
    // A heading of any other depth is not handled either -- the documents use
    // one level, and silently flattening `###` to a paragraph would lose the
    // structure of a clause.
    if (/^#{1,6}\s/.test(trimmed)) found.push(trimmed);
    else if (/^[-*+]\s/.test(trimmed)) found.push(trimmed);
    else if (/^\d+\.\s/.test(trimmed)) found.push(trimmed);
    else if (/^>\s/.test(trimmed)) found.push(trimmed);
    else if (trimmed.startsWith('|') || trimmed.startsWith('```')) found.push(trimmed);
  }
  return found;
}

/**
 * Splits a body into headings and paragraphs.
 *
 * A line starting `## ` is a heading; everything else is joined into
 * paragraphs on blank lines, with single newlines treated as soft wraps, since
 * the committed bodies are hard-wrapped for readability in the source file and
 * those wraps must not become line breaks on the page.
 */
export function parseLegalBody(body: string): readonly LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flush();
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flush();
      blocks.push({ type: 'heading', text: trimmed.slice(3).trim() });
      continue;
    }
    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}
