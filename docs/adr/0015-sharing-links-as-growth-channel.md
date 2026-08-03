# ADR-0015: Sharing links as an organic growth channel

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §0 (item 4), §8.2, §8.3, §9.4, §17, §40, §44, §49 (ADR 15), §51, §52

## Context

The user need is ordinary: a bid manager finds a relevant tender and wants their managing director to see it. Today that means a screenshot or a forwarded Doffin link with no context.

The growth mechanic underneath it is not ordinary. Spec §8.2 identifies the recipient as ICP2, the decision maker who prioritizes the team's time and holds the budget for Luma's courses. §8.3 identifies advisers as spread nodes: one adviser exposes many companies to the service. §17 says the sharing link is both a user feature and the service's most important organic spread mechanism, and should be built accordingly.

Against that sits a privacy problem with teeth. A share link is unauthenticated by design: the recipient must be able to open it without an account, or the mechanic does not work. That means anyone who obtains the URL sees the page. So the page must be worth opening and must contain nothing that would harm the sharer if it were forwarded onward, indexed, or found in a browser history. §51 blocker 11 makes "the shared view leaks no personal data" a launch condition verified in security review.

## Decision

Build sharing as a first-class feature with a hard privacy boundary.

**Model** (§17): `TenderShare` with id, tenderId, createdByUserId, token, expiresAt (default 30 days, `SHARE_DEFAULT_TTL_DAYS`), revokedAt, viewCount, createdAt.

**Token rules** (§40):

- Cryptographically random, generated from a secure source, never derived from user id or tender id, and containing neither in plaintext.
- Stored so that database disclosure does not yield a working link, and compared timing-safely.
- Unique, non-guessable, with sufficient entropy that enumeration is infeasible; rate limiting on `/api/v1/shared/:token` and on the public route makes it infeasible in practice as well.

**What the shared view shows:** tender data, the category marking (including "Planlagt anskaffelse"), a simplified match explanation limited to the reason **types** and not the profile values, the source link to Doffin, and the deadline.

**What it never shows:** who shared it, the profile name, any profile criteria, any other personal data about the sharer, or any promotion beyond the single invitation block.

**The invitation block** is one quiet element at the bottom: "Få dine egne anbudsvarsler fra Luma Training", linked to registration with an attribution parameter. §43 gives the fuller copy. No `EditorialRecommendation` content appears here, and `selectRecommendation` is not called for this surface.

**Lifecycle:** the user sees their own shares at `/delinger` and can revoke them. Expired and revoked tokens return **410** with a neutral page carrying the same invitation, so a stale link is still a soft entry point rather than a dead end. The `share.cleanup` job (§38) removes expired rows on schedule.

**Indexing:** shared views are `noindex`, and the route is excluded in `robots.txt`. The point is internal sharing, not a public tender directory, and §7.3 forbids selling raw Doffin data as a separate dataset.

**Attribution** (§44): `share_created`, `share_viewed` and `share_signup` events, plus the `share_to_signup` attribution type. Reported metrics are shares per active user and signups per share. Per ADR-0006, these are written and read for reporting only; nothing in matching reads them.

## Consequences

### Positive

- The mechanic reaches ICP2 directly, in a moment where the service has already demonstrated its value on a concrete, relevant tender. This is a better first impression than any landing page.
- Advisers become distribution: one adviser sharing across several client companies exposes each of them.
- Because the shared view carries the match explanation types, the recipient sees not just a tender but evidence that the matching is explainable, which is the product's actual differentiator.
- The privacy boundary is simple enough to state in one sentence and therefore simple enough to test.
- A 410 page that still invites signup converts a link's expiry into a small second chance rather than a broken experience.

### Negative / trade-offs

- Anyone with the URL can view it for up to 30 days. That is inherent to unauthenticated sharing and is why the page contains nothing sensitive. The mitigation is the content boundary, not access control.
- Stripping profile values from the match explanation makes it less informative than the sharer's own view. Correct, and deliberate: profile criteria are competitively sensitive business information.
- View counts are approximate. Bots, link previewers and email scanners inflate them. Reported metrics should be read as directional; a naive "signups per share" ratio will understate quality.
- Rate limiting the public route adds a shared-state concern on a path that is otherwise cheap.
- Shared tenders can go stale: the recipient may open a link after the deadline has passed. The view shows the last-synced timestamp and the source link, so staleness is visible rather than hidden.

## Alternatives considered

- **Require login to view a shared tender.** Rejected: it destroys the mechanic. The recipient is exactly the person who does not yet have an account.
- **Share by email through the service, to a named recipient.** Rejected for the MVP: it makes the service a sender of unsolicited mail to addresses that never consented, which conflicts with §20 and with the Postmark stream model in ADR-0005. It is a reasonable later addition with explicit safeguards.
- **Public, permanent, indexable tender pages.** Rejected: it turns the service into a Doffin mirror, competes with the source, conflicts with §7.3, and abandons the internal-sharing framing entirely.
- **Signed JWT tokens carrying tender id and sharer id in the payload.** Rejected by §40: the token must not contain user or tender identifiers in plaintext, and a JWT payload is base64, not encryption. Revocation would also require a denylist, which is the database lookup a random opaque token already does.
- **Showing the sharer's name to give the recipient context.** Tempting for the recipient experience, rejected by §17. The sharer did not consent to their identity travelling with a link they cannot control once forwarded.

## Verification

- A test asserts the rendered shared view HTML contains no user id, no email address, no sharer name, no profile name and no profile criterion value, checked against a fixture where all of those are populated and distinctive.
- A test asserts the shared view's match explanation contains only reason **types** and their generic labels, and never the specific profile values that produced them, while the authenticated tender detail view for the same match does contain them.
- A token test asserts generated tokens are drawn from a cryptographically secure source, are unique across a large sample, and contain neither the tender id nor the user id as a substring in any common encoding.
- A test asserts an expired token and a revoked token both return HTTP 410 with the neutral page, and that the page contains the invitation and no tender data.
- A test asserts revocation takes effect immediately, with no cache allowing a successful view after revoke.
- A test asserts `share.cleanup` removes only rows past `expiresAt` and leaves active shares untouched.
- A test asserts the shared view response carries `X-Robots-Tag: noindex` and that the route is disallowed in `robots.txt`.
- A test asserts exactly one invitation block is rendered and that `selectRecommendation` is not invoked on this code path.
- A rate-limit test asserts repeated requests with random tokens from one source are throttled, exercising the enumeration defence in §40.
- An attribution test asserts a registration completed from a shared-view invitation link produces a `share_to_signup` attribution event linked to the originating share, and that the corresponding `share_created`, `share_viewed` and `share_signup` events exist.
- A security-review item in the launch runbook covers §51 blocker 11 explicitly, with the above tests as its evidence.
