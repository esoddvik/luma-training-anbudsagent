# Keeping the v3 specification copy in sync

`Luma_Anbudsvarsling_IDE_Agent_Specification_v3.md` in the repository root is a
**copy**. The document is authored in Rable, in the note _"Luma Anbudsvarsling
IDE Agent Spec v3: Søk-først, Pluss og dokumentpipeline"_ (id
`f1781a17-8552-413d-8a7b-f5caaaa6639a`).

It is here because `scripts/check-citations.js` needs real headings to resolve
against. Before it existed, the ~80 v3 citations in the code matched no pattern
and nothing verified them, while the check reported a confident green over the
rest of the repository.

Two copies of anything drift. This document is about which drift is caught,
which is not, and what to do about the gap.

## The two directions

| Direction | Caught by | When |
| --- | --- | --- |
| The **copy** is edited here | `pnpm check:spec-copy`, in CI | Every push |
| The **note** is edited in Rable | Nothing automatic | — |

### Why CI cannot check the second one

Rable is reachable only through an MCP connector authenticated in a Claude
session. There is no API token, no service account and no HTTP endpoint a
GitHub runner could call. A CI step that "exports the note and compares" has
nothing to authenticate with, so it cannot be written — not as a matter of
effort, but of access.

This was checked rather than assumed: the connector appears in the session's
tool list, not in `.mcp.json` or any repository configuration, and carries no
credential that could be handed to a runner as a secret.

### What the receipt does prove

The copy's header carries a `body-sha256` over everything below it.
`check-spec-copy` recomputes it on every push. So a hand edit to the
specification text — the drift that actually happens by accident, because the
file sits right there next to the code — turns CI red and says why.

What it does **not** prove is that the copy is current. A green
`check-spec-copy` means *nobody edited this file*, which is a different claim
from *this file matches the note*, and the script's own output says so rather
than letting the name imply otherwise.

## Re-exporting after the note changes

This needs a Claude session with the Rable connector. It is four steps:

1. Read the note: `read_note_content({ id: "f1781a17-8552-413d-8a7b-f5caaaa6639a" })`.
2. Replace everything **after** the `-->` of the provenance header with the
   note body, minus its trailing `#tag` lines. Leave the header itself alone
   except for `note-updated:`, which takes the note's `updated_at`.
3. `node scripts/check-spec-copy.js --record` to write the new hash.
4. `pnpm check:citations`. A section that was renumbered or removed in the note
   will surface here as a dangling citation — which is the point of the copy
   existing at all.

Step 4 is the one worth not skipping. The whole reason to track the copy is
that a renamed section in the note should break the build rather than quietly
make eighty comments wrong.

### Checking for drift without re-exporting

Same session requirement, but cheap enough to do in passing:

```
get_note({ id: "f1781a17-8552-413d-8a7b-f5caaaa6639a" })
```

and compare `updated_at` against the `note-updated:` line in the copy's header.
If they differ, the copy is stale — re-export. If they match, the copy is
current, and unlike the hash this is real evidence of that.

Worth doing whenever v3 is being worked from, and it is the only check that
covers the direction CI is blind to.

## The alternative nobody has picked yet

The gap closes completely if the repository becomes the source of truth and
Rable holds the copy — then `check-spec-copy` is checking the real document and
there is no second direction to worry about. That is a decision about where the
product owner edits specifications, not a technical one, so it is recorded here
as an open option rather than made unilaterally.
