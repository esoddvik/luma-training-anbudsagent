export type PublicNoticeStatus = 'open' | 'closed' | 'cancelled' | 'awarded' | 'unknown';
export type PublicNoticeCategory = 'planned' | 'competition' | 'award' | 'other';

/**
 * Whether a notice should be indexed (IDE Agent Spec v3, section 3.3).
 *
 * A pure policy function, in its own module with no database import, so it can
 * be tested and read without a database anywhere near it — and so a test file
 * can import it statically without dragging `./db` in and defeating its own
 * mocks.
 *
 * **The page emits `noindex` itself when the answer is no**, in addition to the
 * sitemap listing only open and planned notices. Both, deliberately: a sitemap
 * tells a crawler what to *find*, and by the time a competition closes Google
 * has already found it. Removing a URL from a sitemap does not remove it from
 * the index — only a directive on the page does that.
 *
 * `unknown` counts as indexable. Doffin leaves `status` null on a large share
 * of notices and the derivation maps that to `unknown`
 * (`docs/spec-deviations.md`), so treating it as closed would quietly
 * de-index much of the corpus — a live competition hidden because the source
 * declined to say it was live.
 */
export function shouldIndexNotice(input: {
  status: PublicNoticeStatus;
  noticeCategory: PublicNoticeCategory;
}): boolean {
  if (input.noticeCategory === 'award' || input.noticeCategory === 'other') return false;
  return input.status === 'open' || input.status === 'unknown';
}
