# ADR-0012: Norwegian-only customer language

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §5.3, §6, §8, §42, §43, §49 (ADR 12), §51, §52, §53

## Context

The service covers notices published on Doffin, which is Norway (§5.3). The audience is Norwegian suppliers: tender managers, bid leads, project managers and managing directors in construction, facility services, technical services, consulting engineering and IT (§8). The source data is Norwegian. The domain vocabulary is Norwegian and legally loaded: konkurransegrunnlag, kvalifikasjonskrav, tildelingskriterier are terms with specific meanings under the Norwegian procurement regulations, and their English approximations are not equivalent.

Spec §6 requires all customer-facing content in Norwegian bokmål and explicitly instructs not to implement a language selector in the MVP. §51 blocker 8 and §52 criterion 17 both make "all customer text is Norwegian" a launch condition. §6 also permits English for internal technical elements: source code, API fields, database tables, TypeScript types, logs, ADRs, architecture documentation and internal admin tooling.

Half-translated interfaces are a specific failure mode worth naming. An otherwise Norwegian product that says "No results found" in an empty state, or shows an English validation error on a form, reads as unfinished. For a service whose entire proposition is trustworthiness (§3, §42), that impression is expensive.

## Decision

**Customer-facing: Norwegian bokmål only. Internal: English.**

Customer-facing surfaces, all Norwegian: landing pages, registration, login, onboarding, dashboard, alert profiles, tender detail, shared view, MCP setup pages, help text, error messages, empty states, email, order and invoice communication, consent text, privacy links, terms, and administrative messages to customers.

Internal surfaces, English: source code, identifiers, database table and column names, TypeScript types, log messages, ADRs, architecture documentation, and internal admin tooling.

Implementation rules:

1. **No i18n framework, no locale negotiation, no language selector.** A translation library invites a second locale that will not be maintained, and locale negotiation invites an English fallback that must never render.
2. **Customer-facing strings live in one place per surface,** in typed Norwegian string modules under `packages/ui` and `packages/email`, not scattered as inline literals. This is not preparation for translation; it is so that a reviewer can read all customer copy in one pass before launch, which §51 blocker 8 effectively requires.
3. **Error messages are two-layered.** Machine-readable error codes are English and stable (§39). The message rendered to the user is Norwegian, resolved from the code by a mapping with an exhaustive check, so a new code without Norwegian copy fails the build rather than leaking an English string.
4. **Terminology is fixed** by the glossary in §6: anbud, tilbudsarbeid, konkurransegrunnlag, oppdragsgiver, tildelingskriterier, kvalifikasjonskrav, varslingsprofil, anbudsvarsling, planlagt anskaffelse, tilbudsprosess, treff, varsel, faktura. Unnecessary English interface words are avoided.
5. **MCP is a boundary case, resolved deliberately.** Tool names and parameter names are English (`search_tenders`, `noticeCategory`) because they are an API surface consumed by code. Tool descriptions, resource content and prompt text are Norwegian, because an AI client renders them to a Norwegian user and because §33 requires resources named after the playbook phases the course teaches in Norwegian. The `get_luma_learning_resource` topic values are Norwegian playbook phase names (`utvelgelse`, `krav_og_oppdragsforstaelse`) exactly as §32.1 specifies.
6. **Norwegian characters are a correctness requirement, not a rendering detail.** æ, ø and å must survive the database, email encoding, URL slugs, share tokens' surrounding pages and MCP responses. Matching normalizes them (§11), which is a separate concern from displaying them correctly.

## Consequences

### Positive

- The product reads as though it were built for its audience, because it was. No translation seams, no awkward calques of procurement terms.
- Removing i18n machinery removes a whole category of bugs: missing keys, wrong pluralization, fallback chains rendering English into a Norwegian page.
- The single-pass copy review needed before launch is possible because copy is centralized.
- Consistent Norwegian terminology means the service, the course and the playbook use the same words, which is the point of §4.6.

### Negative / trade-offs

- Adding a second language later means introducing i18n across every surface. This is real work and it is knowingly deferred. The centralization of strings makes it less painful than inline literals would, but it does not make it cheap.
- Non-Norwegian-speaking suppliers bidding on Norwegian contracts cannot use the service comfortably. Accepted: the ICP in §8 is Norwegian.
- Contributors who do not read Norwegian cannot review customer copy. Mitigated by English code and English ADRs, so the technical review is unaffected, and by requiring a Norwegian speaker on copy changes.
- The English error code plus Norwegian message mapping is slightly more machinery than a single message would be. Justified by §39's requirement for machine-readable error codes.

## Alternatives considered

- **Norwegian with an English fallback.** Rejected: the fallback is exactly the half-translated state this decision exists to prevent, and §6 forbids a language selector in the MVP.
- **English interface with Norwegian tender data.** Rejected: the audience is Norwegian, the terminology is legally specific, and §43's customer copy is written in Norwegian.
- **An i18n framework configured with only `nb-NO`.** Rejected: cost with no current benefit, plus a fallback mechanism that can only ever misfire.
- **Norwegian MCP tool names.** Rejected: tool names are consumed by AI clients as identifiers, and mixed-language identifiers hurt tool selection. Descriptions carry the Norwegian.

## Verification

- A lint rule flags user-visible string literals in React components and email templates; customer copy must come from the Norwegian string modules. Violations fail CI.
- A test scans the rendered output of every page and email template for a list of common English interface words (Submit, Cancel, Search, Loading, No results, Save, Delete, Settings, Error, Required) and fails on a match.
- An exhaustiveness test asserts every error code defined in the API has a Norwegian message; adding a code without copy fails the type check via a mapped type over the code union.
- A test asserts no i18n library (`next-intl`, `i18next`, `react-intl`, `@formatjs/*`) appears in any `package.json`, and that no `Accept-Language` negotiation exists in middleware.
- An encoding test round-trips a tender whose title contains æ, ø and å through ingest, database, match reason evidence, digest rendering and an MCP response, asserting byte-identical characters at each stage.
- A test asserts every MCP tool has a Norwegian `description` and that resource content under `luma://` is Norwegian, while tool and parameter names match `^[a-z][a-z0-9_]*$` in English.
- A glossary test asserts the §6 terms appear in customer copy and that their common English substitutes (bid, tender document, contracting authority, award criteria) do not.
- A pre-launch review checklist item, recorded in the launch runbook, requires a named Norwegian reviewer to sign off on the full copy inventory, satisfying §51 blocker 8.
