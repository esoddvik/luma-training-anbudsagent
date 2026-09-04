-- Seeds the placeholder terms so a fresh database can accept a signup.
--
-- `legal_document_versions` has existed since 0000 and was populated by
-- nothing: no seed, no migration, no admin surface, no script. `confirmSignup`
-- returns `no_terms` when it is empty, so registration was impossible on every
-- clean deploy, and only tests that inserted their own row ever saw it work.
--
-- The row is a historical fact and is frozen here. Later versions arrive
-- through the reconciliation in apps/web, never by editing this file --
-- `user_legal_acceptances` carries a foreign key onto (kind, version), so
-- rewriting a published version changes what people already agreed to, which
-- is what ADR-11 exists to prevent.
--
-- ON CONFLICT DO NOTHING throughout, because an environment that has already
-- run the sync must not have its rows rewritten by a migration replaying.

INSERT INTO "legal_documents" ("kind", "title")
VALUES ('terms', 'Vilkår for bruk')
ON CONFLICT ("kind") DO NOTHING;
--> statement-breakpoint
INSERT INTO "legal_document_versions" (
	"legal_document_id",
	"kind",
	"version",
	"body",
	"is_placeholder",
	"effective_from"
)
SELECT
	"legal_documents"."id",
	'terms',
	'2026-01-utkast',
	$body$## Om tjenesten

Luma Anbudsvarsling er en gratis tjeneste fra Luma Training som varsler om
kunngjøringer og planlagte anskaffelser publisert på Doffin. Tjenesten er et
hjelpemiddel i tilbudsarbeidet, ikke en erstatning for oppdragsgivers egne
kanaler.

## Ditt ansvar

Du er selv ansvarlig for å følge fristene og kravene i den enkelte
konkurransen. Luma Training svarer ikke for tapte muligheter, forsinkede
varsler eller feil i data hentet fra Doffin.

## Rangering og markedsføring

Kommersielle hensyn påvirker aldri hvilke anbud som rangeres høyest.

## Personopplysninger

Behandling av personopplysninger er beskrevet i Luma Trainings
personvernerklæring. Du kan slette kontoen din når som helst.

Dette er et utkast. Endelige vilkår godkjennes og versjonslagres før tjenesten
åpnes for publikum.$body$,
	true,
	timestamptz '2026-01-01 00:00:00+00'
FROM "legal_documents"
WHERE "legal_documents"."kind" = 'terms'
ON CONFLICT ("kind", "version") DO NOTHING;
