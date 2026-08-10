# Where the specifications live

Both specifications are files in this repository, and both are edited here:

| Document | Covers |
| --- | --- |
| `Luma_Anbudsvarsling_IDE_Agent_Specification_v2.md` | The product: trust contract, data model, phases, launch blockers. 54 sections. |
| `Luma_Anbudsvarsling_IDE_Agent_Specification_v3.md` | Supplements v2: search-first funnel, Anbudsvarsling Pluss, document pipeline, split MCP scope. 13 sections. |

v3 was drafted in Rable and moved here on 2026-08-10. The Rable note is now a
mirror, marked as one at the top. **Edit the file, not the note.**

## Why the source of truth moved instead of being copied

v3 acquired a reader that a note cannot serve. `scripts/check-citations.js`
resolves roughly eighty references in the code against v3's headings, so
renaming a section has to break the build — that is the entire point of
tracking it. Before it was tracked, those eighty citations matched no pattern
and the check reported a confident green over the half of the repository it
could still see.

Tracking a *copy* was the first attempt, and it only half worked. Drift has two
directions:

- **The copy is edited here.** Catchable, and it was caught — a hash over the
  body, recomputed in CI.
- **The note is edited instead.** Not catchable. Rable is reachable only
  through an MCP connector authenticated in a Claude session. There is no API
  token, no service account and no HTTP endpoint a GitHub runner could call, so
  a CI step that exports the note and compares has nothing to authenticate
  with. This was checked, not assumed: the connector appears in the session
  tool list, not in `.mcp.json` or any repository configuration.

A check that covers one direction of a two-direction problem reads as coverage
and is not. Moving the source of truth deletes the second direction rather than
watching it, so the hash receipt and its CI step came back out — with the repo
authoritative, editing the file *is* the correct way to change the
specification, and a check blocking that would fight the workflow it exists to
protect.

## Changing a specification

1. Edit the file.
2. Run `pnpm check:citations`. Renaming or removing a section surfaces here as
   a dangling citation, listing every reference that has to move with it.
3. Commit both together — the specification change and the citations it broke.

Do not renumber v3 into v2's space. They overlap deliberately and the citation
forms distinguish them: a reference names v3 («IDE Agent Spec v3, section 3.2»)
or it is a v2 citation.

## The Rable mirror

Kept because the spec family and the surrounding product notes are read
together there. It carries a banner pointing here and is not authoritative. If
it is ever worth refreshing, that is a manual copy out of this file — no
tooling depends on it, and nothing breaks if it stays behind.
