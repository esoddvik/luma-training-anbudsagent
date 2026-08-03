import { describe, expect, it } from 'vitest';
import { TEMPLATE_NAMES } from '../../types.js';
import { extractUrls } from '../../links.js';
import { findProhibitedPhrases } from '../../prohibited.js';
import { renderAllTemplates } from '../../testing/all-templates.js';

const rendered = renderAllTemplates();

describe('the MVP templates', () => {
  it('renders exactly the templates in TEMPLATE_NAMES', () => {
    expect(rendered.map((email) => email.template).sort()).toEqual([...TEMPLATE_NAMES].sort());
  });

  for (const email of rendered) {
    describe(email.template, () => {
      it('matches the HTML snapshot', () => {
        expect(email.html).toMatchSnapshot();
      });

      it('matches the plain-text snapshot', () => {
        expect(email.text).toMatchSnapshot();
      });

      it('matches the subject snapshot', () => {
        expect(email.subject).toMatchSnapshot();
      });
    });
  }
});

describe('email-client safety', () => {
  for (const email of rendered) {
    describe(email.template, () => {
      it('is a complete HTML document with a declared colour scheme', () => {
        expect(email.html.startsWith('<!doctype html>')).toBe(true);
        expect(email.html).toContain('<html lang="nb">');
        expect(email.html).toContain('name="color-scheme" content="light dark"');
        expect(email.html).toContain('prefers-color-scheme: dark');
      });

      it('uses table layout and no external resources', () => {
        expect(email.html).toContain('<table role="presentation"');
        expect(email.html).not.toMatch(/<script/i);
        expect(email.html).not.toMatch(/<link\s/i);
        expect(email.html).not.toMatch(/<img\s/i);
        expect(email.html).not.toMatch(/@import/i);
        expect(email.html).not.toMatch(/@font-face/i);
        expect(email.html).not.toMatch(/display\s*:\s*flex/i);
        expect(email.html).not.toMatch(/display\s*:\s*grid/i);
      });

      it('constrains the body to 600px', () => {
        expect(email.html).toContain('max-width:600px');
      });

      it('has a non-empty subject and text part', () => {
        expect(email.subject.trim().length).toBeGreaterThan(0);
        expect(email.text.trim().length).toBeGreaterThan(40);
      });
    });
  }
});

describe('link parity between the HTML and text parts', () => {
  for (const email of rendered) {
    it(`${email.template} offers the same links in both parts`, () => {
      const htmlUrls = new Set(extractUrls(email.html));
      const textUrls = new Set(extractUrls(email.text));

      const missingFromText = [...htmlUrls].filter((url) => !textUrls.has(url));
      const missingFromHtml = [...textUrls].filter((url) => !htmlUrls.has(url));

      expect({ missingFromText, missingFromHtml }).toEqual({
        missingFromText: [],
        missingFromHtml: [],
      });
      expect(htmlUrls.size).toBeGreaterThan(0);
    });
  }
});

describe('UTM attribution (spec section 44.2)', () => {
  /**
   * The magic link is a single-use credential, not an attribution surface.
   * Appending analytics parameters to it would measure nothing and would put
   * query junk on the one URL whose parsing has to be exact.
   */
  const isCredentialUrl = (url: URL): boolean => url.pathname.includes('/logg-inn/bekreft/');

  for (const email of rendered) {
    it(`${email.template} tags every Luma link and leaves Doffin alone`, () => {
      for (const url of extractUrls(email.html)) {
        const parsed = new URL(url);
        if (isCredentialUrl(parsed)) {
          expect([...parsed.searchParams.keys()]).toEqual([]);
        } else if (parsed.hostname.endsWith('doffin.no')) {
          expect([...parsed.searchParams.keys()].filter((key) => key.startsWith('utm_'))).toEqual(
            [],
          );
        } else {
          expect(parsed.searchParams.get('utm_source')).toBe('anbudsvarsling');
          expect(parsed.searchParams.get('utm_medium')).toBeTruthy();
        }
      }
    });
  }
});

/**
 * The shared prohibition scan (spec sections 4.3, 23.5, 28.2, 42).
 *
 * Run over every rendered template rather than over the copy module, so that
 * a phrase assembled at runtime - a subject line, an interpolated product
 * name - is caught as readily as a constant.
 */
describe('forbidden phrasing', () => {
  for (const email of rendered) {
    it(`${email.template} contains none`, () => {
      const matches = [
        ...findProhibitedPhrases(email.subject),
        ...findProhibitedPhrases(email.text),
        ...findProhibitedPhrases(email.html),
      ];
      expect(
        matches.map((match) => `${match.ruleId}: «${match.matched}» – ${match.explanation}`),
      ).toEqual([]);
    });
  }

  it('would catch a template that made a winning claim', () => {
    const badCopy =
      'Dere har 94 prosent sannsynlighet for å vinne. Garantert treff, men du må handle nå.';
    const found = findProhibitedPhrases(badCopy).map((match) => match.ruleId);
    expect(found).toContain('win-probability');
    expect(found).toContain('guarantee');
    expect(found).toContain('obligation-second-person');
  });
});

describe('Norwegian bokmål only (spec section 6)', () => {
  /** Words that would betray an English placeholder in customer-facing copy. */
  const ENGLISH_TELLS = [
    'Unsubscribe',
    'Click here',
    'View in browser',
    'Dear ',
    'Best regards',
    'Tender alert',
    'Lorem ipsum',
    'TODO',
    'placeholder',
  ];

  for (const email of rendered) {
    it(`${email.template} has no English placeholder copy`, () => {
      const visible = email.text;
      for (const tell of ENGLISH_TELLS) {
        expect(visible.toLowerCase()).not.toContain(tell.toLowerCase());
      }
    });
  }
});
