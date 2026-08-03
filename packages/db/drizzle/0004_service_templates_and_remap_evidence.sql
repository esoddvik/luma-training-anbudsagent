-- Industry templates become service templates (ADR-17).
--
-- A profile is defined by what the business delivers, never by the industry it
-- belongs to. The rename is the visible half; the half that needs care is that
-- five templates become eight, and the map between them is lossy in two places
-- that no data in this database can settle.
--
-- So this migration does not quietly repoint the profiles and move on. Every
-- profile it touches gets a row in `alert_profile_template_remaps` naming what
-- it used to be filed under, and the two editorial guesses are flagged
-- `needs_review`. A comment in a migration file is not evidence; a row is.

--> statement-breakpoint
CREATE TYPE "public"."supplier_form" AS ENUM('sector_bound', 'cross_sector');--> statement-breakpoint
CREATE TABLE "alert_profile_template_remaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_profile_id" uuid NOT NULL,
	"service_template_id" uuid,
	"from_slug" text NOT NULL,
	"from_name" text NOT NULL,
	"to_slug" text NOT NULL,
	"to_name" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"rationale" text NOT NULL,
	"remapped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "industry_templates" RENAME TO "service_templates";--> statement-breakpoint
ALTER TABLE "alert_profiles" RENAME COLUMN "industry_template_id" TO "service_template_id";--> statement-breakpoint
ALTER TABLE "service_templates" DROP CONSTRAINT "industry_templates_slug_format";--> statement-breakpoint
ALTER TABLE "alert_profiles" DROP CONSTRAINT "alert_profiles_industry_template_id_industry_templates_id_fk";
--> statement-breakpoint
DROP INDEX "industry_templates_slug_key";--> statement-breakpoint
DROP INDEX "industry_templates_active_sort_idx";--> statement-breakpoint

-- The three new columns arrive nullable. `service_category` and
-- `supplier_form` are NOT NULL in the schema and are made so at the end of
-- this migration; adding them NOT NULL up front would fail against any
-- database that already holds templates, which is every database that matters.
ALTER TABLE "service_templates" ADD COLUMN "service_category" text;--> statement-breakpoint
ALTER TABLE "service_templates" ADD COLUMN "supplier_form" "supplier_form";--> statement-breakpoint
ALTER TABLE "service_templates" ADD COLUMN "onboarding_hint" text;--> statement-breakpoint

ALTER TABLE "alert_profile_template_remaps" ADD CONSTRAINT "alert_profile_template_remaps_alert_profile_id_alert_profiles_id_fk" FOREIGN KEY ("alert_profile_id") REFERENCES "public"."alert_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_profile_template_remaps" ADD CONSTRAINT "alert_profile_template_remaps_service_template_id_service_templates_id_fk" FOREIGN KEY ("service_template_id") REFERENCES "public"."service_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_profile_template_remaps_profile_idx" ON "alert_profile_template_remaps" USING btree ("alert_profile_id");--> statement-breakpoint
CREATE INDEX "alert_profile_template_remaps_review_idx" ON "alert_profile_template_remaps" USING btree ("needs_review","remapped_at");--> statement-breakpoint
ALTER TABLE "alert_profiles" ADD CONSTRAINT "alert_profiles_service_template_id_service_templates_id_fk" FOREIGN KEY ("service_template_id") REFERENCES "public"."service_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Refuse to guess.
--
-- The map below covers the five seeded templates and nothing else. A template
-- row with any other slug was created outside this repository, and there is no
-- honest default for its category: picking one would put real users into a
-- segment nobody chose, and every count grouped on that segment would then be
-- wrong in a way that still looks plausible. Failing here costs a deploy and a
-- one-line addition to the map. Guessing costs the segmentation.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
	unknown_slugs text;
BEGIN
	SELECT string_agg(slug, ', ' ORDER BY slug) INTO unknown_slugs
	FROM service_templates
	WHERE slug NOT IN (
		'bygg-og-anlegg',
		'radgivende-ingeniorer',
		'drift-renhold-og-fm',
		'tekniske-tjenester',
		'it-og-konsulenttjenester'
	);

	IF unknown_slugs IS NOT NULL THEN
		RAISE EXCEPTION
			'0004 cannot remap unrecognised service template(s): %. Add them to the mapping in this migration with a service_category and supplier_form chosen by an editor, then re-run. Do not pick a category to make the migration pass.',
			unknown_slugs;
	END IF;
END
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The evidence, written before anything is rewritten.
--
-- One row per affected profile, including the three exact renames. A log that
-- listed only the suspect rows could not be used to check its own coverage:
-- "no row for this profile" would mean both "unaffected" and "we forgot".
-- ---------------------------------------------------------------------------
INSERT INTO alert_profile_template_remaps (
	alert_profile_id, service_template_id, from_slug, from_name, to_slug, to_name, needs_review, rationale
)
SELECT
	p.id,
	t.id,
	t.slug,
	t.name,
	m.to_slug,
	m.to_name,
	m.needs_review,
	m.rationale
FROM alert_profiles p
JOIN service_templates t ON t.id = p.service_template_id
JOIN (
	VALUES
		(
			'bygg-og-anlegg',
			'bygg-og-anlegg-utforende',
			'Bygg og anlegg, utførende',
			false,
			'Direkte videreføring. Innholdet er uendret; navnet presiserer at malen gjelder utførende entreprenører og ikke rådgivere.'
		),
		(
			'radgivende-ingeniorer',
			'radgivende-ingeniortjenester',
			'Rådgivende ingeniørtjenester',
			false,
			'Direkte videreføring. Innholdet er uendret; navnet beskriver tjenesten som leveres i stedet for yrkesgruppen som leverer den.'
		),
		(
			'drift-renhold-og-fm',
			'renhold-og-facility-management',
			'Renhold og facility management',
			true,
			'Skjønnsvurdering. «Drift, renhold og facility management» er delt i to: renhold og facility management, og drift og vedlikehold av eiendom. Eksisterende profiler er lagt til renholdssiden fordi renhold er den største og tydeligst avgrensede delen av det gamle segmentet. Ingen data i systemet avgjør hvor den enkelte profilen hører hjemme. Må bekreftes av en redaktør.'
		),
		(
			'tekniske-tjenester',
			'drift-og-vedlikehold-av-eiendom',
			'Drift og vedlikehold av eiendom',
			true,
			'Skjønnsvurdering. «Tekniske tjenester» har ingen reell etterfølger i den nye malsettingen. Profilene er lagt til drift og vedlikehold av eiendom fordi CPV-kodene og søkeordene ligger nærmest der, men et elektro- eller ventilasjonsfirma kan like gjerne høre hjemme under bygg og anlegg. Må bekreftes av en redaktør.'
		),
		(
			'it-og-konsulenttjenester',
			'it-tjenester-og-konsulentbistand',
			'IT-tjenester og konsulentbistand',
			false,
			'Direkte videreføring. Innholdet er uendret; navnet skiller tydeligere mellom IT-tjenester og konsulentbistand.'
		)
) AS m(from_slug, to_slug, to_name, needs_review, rationale) ON m.from_slug = t.slug;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Now the templates themselves.
--
-- Identity is rewritten: slug, name, and the three new columns. The editorial
-- body — description, CPV lists, keyword lists — is left alone, because those
-- are the fields an admin is most likely to have tuned since seeding and this
-- migration has no way to tell a tuned value from the original. The one
-- exception is a description still identical to the seed text, which nobody
-- has touched and which would otherwise contradict the row's new name.
-- ---------------------------------------------------------------------------
UPDATE service_templates AS t
SET
	slug = m.to_slug,
	name = m.to_name,
	sort_order = m.sort_order,
	service_category = m.service_category,
	supplier_form = m.supplier_form::supplier_form,
	onboarding_hint = m.onboarding_hint,
	description = CASE WHEN t.description = m.seeded_description THEN m.new_description ELSE t.description END,
	updated_at = now()
FROM (
	VALUES
		(
			'bygg-og-anlegg',
			'bygg-og-anlegg-utforende',
			'Bygg og anlegg, utførende',
			1,
			'bygg-og-anlegg',
			'sector_bound',
			'Sett geografi og terskelverdier først – de avgjør mest for en entreprenør. Har du faste oppdragsgivere, kan du legge dem til, men la kjøperfeltene stå tomme hvis du er i tvil.',
			'For entreprenører som bygger, rehabiliterer og vedlikeholder bygg, veier og annen infrastruktur.',
			'For entreprenører som bygger, rehabiliterer og vedlikeholder bygg, veier og annen infrastruktur.'
		),
		(
			'radgivende-ingeniorer',
			'radgivende-ingeniortjenester',
			'Rådgivende ingeniørtjenester',
			2,
			'prosjektering-og-radgivning',
			'sector_bound',
			'Etterspørselen samler seg hos noen få typer oppdragsgivere. Velg fylke først, og legg eventuelt til oppdragsgivere du allerede jobber for hvis du vil spisse ytterligere.',
			'For rådgivere som leverer prosjektering, byggeledelse, utredninger og teknisk kontroll.',
			'For rådgivere som leverer prosjektering, byggeledelse, utredninger og teknisk kontroll.'
		),
		(
			'drift-renhold-og-fm',
			'renhold-og-facility-management',
			'Renhold og facility management',
			3,
			'renhold-og-facility-management',
			'cross_sector',
			'Kundene dine kan være hvem som helst – sykehus, skoler, kollektivselskaper, Forsvaret. Bruk geografi som hovedavgrensning, og la kjøperfeltene stå tomme.',
			'For leverandører av renhold, drift, vaktmestertjenester og forvaltning av bygg og eiendom.',
			'For leverandører av renhold, renholdsledelse og samlet forvaltning av bygg og eiendom.'
		),
		(
			'tekniske-tjenester',
			'drift-og-vedlikehold-av-eiendom',
			'Drift og vedlikehold av eiendom',
			5,
			'drift-og-vedlikehold-av-eiendom',
			'cross_sector',
			'Bygg som skal driftes finnes overalt. Sett geografi og reisevei først, og la kjøperfeltene stå tomme.',
			'For elektro, rør, ventilasjon, automasjon og annen teknisk installasjon og service.',
			'For leverandører av vaktmestertjenester, teknisk drift og vedlikehold av bygg og uteområder.'
		),
		(
			'it-og-konsulenttjenester',
			'it-tjenester-og-konsulentbistand',
			'IT-tjenester og konsulentbistand',
			4,
			'it-tjenester',
			'cross_sector',
			'Oppdragene kommer fra alle deler av offentlig sektor. Avgrens på geografi og kontraktstørrelse, ikke på hvem som kjøper.',
			'For leverandører av systemutvikling, IT-drift, skytjenester og digital rådgivning.',
			'For leverandører av systemutvikling, IT-drift, skytjenester og digital rådgivning.'
		)
) AS m(
	from_slug, to_slug, to_name, sort_order, service_category, supplier_form,
	onboarding_hint, seeded_description, new_description
)
WHERE t.slug = m.from_slug;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The three templates with no predecessor.
--
-- Only into a database that already holds templates. A fresh database has none
-- — there is no seed step in this repository, and onboarding falls back to
-- `SERVICE_TEMPLATE_SEEDS` in `@luma/content` when the table is empty. Adding
-- three of eight rows to an empty table would break that fallback and leave a
-- new environment offering a third of the set with nothing to say why.
--
-- The CPV and keyword lists are deliberately absent here. Seeding editorial
-- content through a migration would make this file a second source of truth
-- for content that admin owns; these rows are created inactive so they cannot
-- reach onboarding half-populated, and an editor fills them in and activates
-- them from `SERVICE_TEMPLATE_SEEDS`.
-- ---------------------------------------------------------------------------
INSERT INTO service_templates (
	slug, name, description, sort_order, active, service_category, supplier_form, onboarding_hint
)
SELECT
	m.slug, m.name, m.description, m.sort_order, false, m.service_category,
	m.supplier_form::supplier_form, m.onboarding_hint
FROM (
	VALUES
		(
			'vakthold-og-sikkerhet',
			'Vakthold og sikkerhet',
			'For leverandører av vakthold, vektertjenester, alarmmottak og fysisk adgangskontroll.',
			6,
			'vakthold-og-sikkerhet',
			'cross_sector',
			'Vaktoppdrag lyses ut av alt fra museer til fylkeskommuner. Geografi er den viktigste avgrensningen; hvem som kjøper sier lite.'
		),
		(
			'kantine-og-matservering',
			'Kantine og matservering',
			'For leverandører som drifter kantiner, leverer catering og står for matservering hos oppdragsgiveren.',
			7,
			'kantine-og-matservering',
			'cross_sector',
			'Kantiner drives hos statlige etater, sykehus, skoler og private byggeiere. Avgrens på geografi, ikke på type oppdragsgiver.'
		),
		(
			'bemanning-og-rekruttering',
			'Bemanning og rekruttering',
			'For bemanningsbyråer og rekrutteringsselskaper som leier ut personell eller finner faste ansatte til oppdragsgiveren.',
			8,
			'bemanning-og-rekruttering',
			'cross_sector',
			'Behovet for innleie finnes i hele offentlig sektor. Bruk geografi og fagområde som avgrensning, og la kjøperfeltene stå tomme.'
		)
) AS m(slug, name, description, sort_order, service_category, supplier_form, onboarding_hint)
WHERE EXISTS (SELECT 1 FROM service_templates)
  AND NOT EXISTS (SELECT 1 FROM service_templates existing WHERE existing.slug = m.slug);
--> statement-breakpoint

ALTER TABLE "service_templates" ALTER COLUMN "service_category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "service_templates" ALTER COLUMN "supplier_form" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "service_templates_slug_key" ON "service_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "service_templates_active_sort_idx" ON "service_templates" USING btree ("active","sort_order");--> statement-breakpoint
CREATE INDEX "service_templates_category_idx" ON "service_templates" USING btree ("service_category");--> statement-breakpoint
ALTER TABLE "service_templates" ADD CONSTRAINT "service_templates_slug_format" CHECK ("service_templates"."slug" ~ '^[a-z0-9-]+$');
