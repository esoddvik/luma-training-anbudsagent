/**
 * Email-client-safe HTML primitives.
 *
 * The constraints are not stylistic. Outlook renders with Word, Gmail strips
 * `<head>` styles in the mobile clients, and several clients force a dark
 * palette on any element that has not declared its own. So:
 *
 * - tables for layout, never flexbox or grid;
 * - inline styles on every element that needs one, never a class;
 * - no external stylesheet, no web font, no image, no JavaScript;
 * - 600px maximum width;
 * - an explicit `background-color` *and* `color` on every container, so that
 *   a client that inverts one of them cannot produce white-on-white.
 *
 * The single `<style>` block is limited to the dark-mode media query, which
 * cannot be expressed inline. Every client that drops it still gets a
 * readable light-mode email, because the inline styles stand alone.
 */

/** Palette. Light values are inline; the dark overrides live in the media query. */
export const PALETTE = {
  pageBackground: '#f4f4f2',
  cardBackground: '#ffffff',
  border: '#dcdcd6',
  text: '#1a1a1a',
  mutedText: '#5b5b57',
  link: '#1c4b8c',
  /** The promotion block is visually distinct from tender content (spec 23.4). */
  promotionBackground: '#f0efe9',
  promotionBorder: '#c9c7bb',
  plannedBackground: '#f7f5ef',
  plannedBorder: '#d8d2be',
} as const;

export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const MAX_WIDTH_PX = 600;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for use in element content or an attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * Reverses `escapeHtml` for the named entities it produces.
 *
 * Needed by the link-parity test: a URL with UTM parameters contains `&`,
 * which is `&amp;` in the HTML attribute and a bare `&` in the text part.
 */
export function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Serialises an inline style object, skipping undefined values. */
export function style(declarations: Readonly<Record<string, string | undefined>>): string {
  return Object.entries(declarations)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([property, value]) => `${property}:${value}`)
    .join(';');
}

const BASE_TEXT_STYLE = style({
  margin: '0 0 12px 0',
  'font-family': FONT_STACK,
  'font-size': '15px',
  'line-height': '1.5',
  color: PALETTE.text,
});

const MUTED_TEXT_STYLE = style({
  margin: '0 0 8px 0',
  'font-family': FONT_STACK,
  'font-size': '13px',
  'line-height': '1.5',
  color: PALETTE.mutedText,
});

/** A body paragraph. */
export function paragraph(text: string, options?: { muted?: boolean }): string {
  const className = options?.muted ? 'luma-muted' : 'luma-text';
  const inline = options?.muted ? MUTED_TEXT_STYLE : BASE_TEXT_STYLE;
  return `<p class="${className}" style="${inline}">${escapeHtml(text)}</p>`;
}

/** A paragraph whose content is already-escaped markup. */
export function rawParagraph(markup: string, options?: { muted?: boolean }): string {
  const className = options?.muted ? 'luma-muted' : 'luma-text';
  const inline = options?.muted ? MUTED_TEXT_STYLE : BASE_TEXT_STYLE;
  return `<p class="${className}" style="${inline}">${markup}</p>`;
}

export function heading(text: string, level: 1 | 2 | 3): string {
  const sizes: Record<1 | 2 | 3, string> = { 1: '22px', 2: '18px', 3: '15px' };
  const inline = style({
    margin: level === 1 ? '0 0 8px 0' : '0 0 8px 0',
    'font-family': FONT_STACK,
    'font-size': sizes[level],
    'line-height': '1.3',
    'font-weight': '600',
    color: PALETTE.text,
  });
  return `<h${level} class="luma-text" style="${inline}">${escapeHtml(text)}</h${level}>`;
}

const LINK_STYLE = style({
  color: PALETTE.link,
  'text-decoration': 'underline',
});

/** An anchor. `href` is escaped, so `&` becomes `&amp;` as the spec requires. */
export function link(href: string, label: string): string {
  return `<a class="luma-link" href="${escapeHtml(href)}" style="${LINK_STYLE}">${escapeHtml(label)}</a>`;
}

/**
 * A bordered, full-width container. Every card, section and block in the
 * email is one of these, so the visual separation rule in spec section 23.4
 * is a single primitive rather than nine hand-rolled tables.
 */
export function panel(
  content: string,
  options?: {
    background?: string;
    borderColor?: string;
    marker?: string;
    className?: string;
    attributes?: Readonly<Record<string, string>>;
  },
): string {
  const background = options?.background ?? PALETTE.cardBackground;
  const borderColor = options?.borderColor ?? PALETTE.border;
  const cellStyle = style({
    padding: '16px 18px',
    'background-color': background,
    border: `1px solid ${borderColor}`,
    'border-radius': '4px',
    color: PALETTE.text,
  });
  const attributes = Object.entries(options?.attributes ?? {})
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
  const marker = options?.marker ? `<!--${options.marker}-->` : '';
  const className = options?.className ?? 'luma-panel';
  return [
    marker,
    `<table role="presentation" class="${className}" width="100%" cellpadding="0" cellspacing="0" border="0"${attributes} style="${style(
      {
        width: '100%',
        'border-collapse': 'separate',
        'margin-bottom': '14px',
      },
    )}">`,
    `<tr><td class="${className}-cell" style="${cellStyle}">`,
    content,
    '</td></tr>',
    '</table>',
  ].join('\n');
}

/** A horizontal rule, used to fence the promotion block off from the content. */
export function separator(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${style(
    { width: '100%' },
  )}"><tr><td style="${style({
    'border-top': `2px solid ${PALETTE.promotionBorder}`,
    'font-size': '0',
    'line-height': '0',
    height: '1px',
  })}">&nbsp;</td></tr></table>`;
}

/** A label/value row, used by the tender card and the order summary. */
export function definitionRow(label: string, value: string): string {
  return `<tr><td style="${style({
    padding: '2px 12px 2px 0',
    'font-family': FONT_STACK,
    'font-size': '13px',
    'line-height': '1.5',
    color: PALETTE.mutedText,
    'vertical-align': 'top',
    'white-space': 'nowrap',
  })}" class="luma-muted">${escapeHtml(label)}</td><td style="${style({
    padding: '2px 0',
    'font-family': FONT_STACK,
    'font-size': '13px',
    'line-height': '1.5',
    color: PALETTE.text,
    'vertical-align': 'top',
  })}" class="luma-text">${escapeHtml(value)}</td></tr>`;
}

export function definitionList(rows: readonly string[]): string {
  if (rows.length === 0) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${style({
    'border-collapse': 'collapse',
    'margin-bottom': '10px',
  })}">${rows.join('')}</table>`;
}

/** A bulleted list. */
export function bulletList(items: readonly string[]): string {
  if (items.length === 0) return '';
  const itemStyle = style({
    'font-family': FONT_STACK,
    'font-size': '14px',
    'line-height': '1.5',
    color: PALETTE.text,
    'margin-bottom': '4px',
  });
  const rendered = items
    .map((item) => `<li class="luma-text" style="${itemStyle}">${escapeHtml(item)}</li>`)
    .join('');
  return `<ul style="${style({ margin: '0 0 12px 0', 'padding-left': '20px' })}">${rendered}</ul>`;
}

/** A list whose items are already-escaped markup, used for link rows. */
export function rawBulletList(items: readonly string[]): string {
  if (items.length === 0) return '';
  const itemStyle = style({
    'font-family': FONT_STACK,
    'font-size': '14px',
    'line-height': '1.5',
    color: PALETTE.text,
    'margin-bottom': '4px',
  });
  const rendered = items
    .map((item) => `<li class="luma-text" style="${itemStyle}">${item}</li>`)
    .join('');
  return `<ul style="${style({ margin: '0 0 12px 0', 'padding-left': '20px' })}">${rendered}</ul>`;
}

/**
 * Dark-mode overrides.
 *
 * Kept minimal and additive. Clients that strip `<head>` styles fall back to
 * the inline light palette, which is legible on every background because each
 * container sets its own.
 */
const DARK_MODE_STYLES = `
@media (prefers-color-scheme: dark) {
  .luma-page { background-color: #16171a !important; }
  .luma-panel-cell, .luma-promotion-cell, .luma-planned-cell {
    background-color: #212227 !important;
    border-color: #3a3b42 !important;
  }
  .luma-text, .luma-text * { color: #f2f2f0 !important; }
  .luma-muted, .luma-muted * { color: #b6b6b2 !important; }
  .luma-link { color: #9dc0f0 !important; }
}
`.trim();

/**
 * Wraps body markup in a complete, standalone HTML document.
 *
 * `preheader` is the snippet most clients show next to the subject line. It is
 * hidden in the body itself with the standard zero-size technique.
 */
export function document(input: { title: string; preheader: string; body: string }): string {
  const hiddenPreheader = `<div style="${style({
    display: 'none',
    'font-size': '1px',
    color: PALETTE.pageBackground,
    'line-height': '1px',
    'max-height': '0',
    'max-width': '0',
    opacity: '0',
    overflow: 'hidden',
  })}">${escapeHtml(input.preheader)}</div>`;

  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.title)}</title>
<style>${DARK_MODE_STYLES}</style>
</head>
<body class="luma-page" style="${style({
    margin: '0',
    padding: '0',
    'background-color': PALETTE.pageBackground,
    color: PALETTE.text,
    '-webkit-text-size-adjust': '100%',
  })}">
${hiddenPreheader}
<table role="presentation" class="luma-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="${style(
    {
      width: '100%',
      'background-color': PALETTE.pageBackground,
    },
  )}">
<tr>
<td align="center" style="${style({ padding: '20px 12px' })}">
<table role="presentation" width="${MAX_WIDTH_PX}" cellpadding="0" cellspacing="0" border="0" style="${style(
    {
      width: '100%',
      'max-width': `${MAX_WIDTH_PX}px`,
      'text-align': 'left',
    },
  )}">
<tr>
<td>
${input.body}</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
}
