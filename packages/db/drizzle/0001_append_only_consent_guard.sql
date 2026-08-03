-- Hand-written migration. Not produced by drizzle-kit, and it must not be
-- regenerated: `drizzle-kit generate` diffs table structure and knows nothing
-- about triggers, so it will neither create nor drop what is below.
--
-- Purpose: make ADR-0009 ("consent history is never overwritten") a property
-- of the database rather than a rule people are asked to remember. Spec
-- section 37 states the requirement; ADR-0009's verification section asks
-- specifically for a database-level guard with a test that an attempted update
-- raises. `consent-immutability.integration.test.ts` is that test.
--
-- Why a trigger rather than revoking UPDATE and DELETE from the application
-- role: the application connects as the owner in every environment we control,
-- and an owner's privileges can be granted back by anything holding the same
-- credentials. A trigger fires for the owner too.

CREATE OR REPLACE FUNCTION luma_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Table %.% is append-only (ADR-0009): DELETE is not permitted. Record a new event instead.',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Exactly one mutation is permitted: severing the user reference when an
  -- account is deleted. That is what the ON DELETE SET NULL foreign key does,
  -- and without this branch a user deletion would fail outright — which spec
  -- section 40 does not allow.
  --
  -- The comparison is over the whole row minus `user_id`, so the exemption
  -- cannot be used as a side door to edit a status, a text version or a
  -- timestamp while nulling the reference.
  IF NEW.user_id IS NULL
     AND OLD.user_id IS NOT NULL
     AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Table %.% is append-only (ADR-0009): UPDATE is not permitted. Withdrawal and re-grant are new rows.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS consent_events_append_only ON "consent_events";
--> statement-breakpoint

CREATE TRIGGER consent_events_append_only
BEFORE UPDATE OR DELETE ON "consent_events"
FOR EACH ROW EXECUTE FUNCTION luma_append_only_guard();
--> statement-breakpoint

-- `user_legal_acceptances` records which version of the terms a person
-- accepted. It carries the same evidential weight as a consent event and is
-- written the same way (insert only), so it gets the same guard.
DROP TRIGGER IF EXISTS user_legal_acceptances_append_only ON "user_legal_acceptances";
--> statement-breakpoint

CREATE TRIGGER user_legal_acceptances_append_only
BEFORE UPDATE OR DELETE ON "user_legal_acceptances"
FOR EACH ROW EXECUTE FUNCTION luma_append_only_guard();
--> statement-breakpoint

-- Comments that survive into the database itself, so that someone reading the
-- schema through psql or a GUI sees the constraint's reason and not only its
-- shape. These are the two places where a well-intentioned cleanup would do
-- legal or privacy damage.
COMMENT ON TABLE "consent_events" IS
  'Append-only consent log (spec 21, ADR-0009). Guarded by trigger consent_events_append_only: no DELETE, and no UPDATE except severing user_id on account deletion. Withdrawal and re-grant are new rows. Do not "clean up" duplicates: the sequence is the evidence.';
--> statement-breakpoint

COMMENT ON TABLE "user_legal_acceptances" IS
  'Append-only record of which legal document version a user accepted (spec 19, ADR-0011). Same guard as consent_events.';
--> statement-breakpoint

COMMENT ON COLUMN "tenders"."raw_payload" IS
  'Unmodified payload from the public procurement source. MUST NOT contain user data (spec 37): it is copied verbatim into tender_revisions, and an account deletion cannot reach inside a JSON blob.';
--> statement-breakpoint

COMMENT ON COLUMN "tender_revisions"."raw_payload" IS
  'Historical source payload. Same rule as tenders.raw_payload: public source data only, never user data (spec 37).';
--> statement-breakpoint

COMMENT ON TABLE "attribution_events" IS
  'Commercial attribution measurement (spec 44.2, ADR-0006). Has no foreign key into tender_matches, tender_match_reasons or alert_profiles, and must never gain one: spec 37 forbids linking attribution to matching logic beyond tender_id for reporting. Adding such a column would make it possible to rank tenders by revenue.';
--> statement-breakpoint

COMMENT ON COLUMN "attribution_events"."tender_id" IS
  'The only permitted tender-side reference, for reporting (spec 37). Not to be joined to a match.';
--> statement-breakpoint

COMMENT ON COLUMN "sessions"."token_hash" IS
  'SHA-256 of the session cookie value. The plaintext is never stored (ADR-0016).';
--> statement-breakpoint

COMMENT ON COLUMN "magic_link_tokens"."token_hash" IS
  'SHA-256 of the magic-link token. The plaintext exists only in the email that was sent (ADR-0016).';
--> statement-breakpoint

COMMENT ON COLUMN "mcp_tokens"."token_hash" IS
  'Peppered hash of the MCP token. The full token is shown to the user exactly once and never stored (spec 30).';
--> statement-breakpoint

COMMENT ON COLUMN "tender_shares"."token" IS
  'Cryptographically random. Must not encode a user id or a tender id, and must not be derived from either (spec 40).';
