import Link from 'next/link';
import { Button, Field, Input, Stack } from '@luma/ui';
import { SIGNUP_EMAIL_HINT, SIGNUP_EMAIL_LABEL, SIGNUP_SUBMIT } from '@/content/copy';
import { requestSignupAction } from '@/server/actions/registration-actions';

/**
 * Signing up from the trade page you are already reading
 * (IDE Agent Spec v3, section 3.2).
 *
 * ## Why the form is here rather than a link back to the landing page
 *
 * The first version of these pages ended in a link to `/#registrering` with
 * `?bransje=…&landsdel=…` attached, and the landing form ignored both. Fixing
 * *that* by reading the query string would have made the landing page dynamic
 * — a page cannot read `searchParams` and stay statically prerendered — and
 * section 3.2 keeps public pages static for exactly the reasons this funnel
 * exists: indexable and instant.
 *
 * Putting the form on the page it belongs to avoids the choice entirely. The
 * template is known at render time, so it is a hidden input rather than a
 * query parameter; the page stays static; and the reader signs up from where
 * they already are instead of bouncing to a landing page to re-pick the trade
 * they just spent a minute reading about.
 *
 * The hidden values are not trusted. `requestSignupAction` re-resolves the
 * posted slug against the live `service_templates` table, so a forged option
 * cannot write arbitrary criteria into a profile.
 *
 * ## Still a plain form, on a page whose results are filtered in the browser
 *
 * `results-explorer.tsx` next door is a client component; this is not, and it
 * sits inside it as a slot. That is the point: the rail must submit on a page
 * whose JavaScript never arrived, so it stays a `<form action={…}>` with hidden
 * fields and no client state. The design draws a «Lenke sendt» panel; the real
 * one is the redirect to `/registrering/sjekk-e-post` that the action already
 * performs, which survives having no bundle at all.
 */
export function InlineSignup({
  templateSlug,
  templateName,
  landsdelSlug,
  landsdelName,
}: {
  templateSlug: string;
  templateName: string;
  landsdelSlug?: string;
  landsdelName?: string;
}) {
  return (
    <section
      aria-labelledby="varsling-tittel"
      className="luma-card flex flex-col gap-md"
      id="registrering"
    >
      <h2 id="varsling-tittel" className="m-0 text-xl font-semibold">
        Få disse treffene på e-post
      </h2>
      <p className="m-0 text-sm text-text-muted">
        Vi følger med på nye kunngjøringer for {templateName.toLowerCase()}
        {landsdelName ? ` i ${landsdelName}` : ''} og sender deg treffene. Gratis. Profilen starter
        på pause, så du rekker å se over kriteriene før det første varselet går ut.
      </p>
      {/*
       * ## No consent checkbox here, and that is the honest shape
       *
       * The design draws «Jeg godtar vilkårene» on this card. A version of
       * this file shipped it as a `required` checkbox, enforced by the
       * browser's own constraint validation — which is not enforcement. The
       * field would have gated nothing: `requestSignupAction` never reads it,
       * and a crafted POST skips the browser entirely.
       *
       * The deeper reason it does not belong here is that acceptance is not
       * recorded at this step at all. `confirmSignup` writes the
       * `user_legal_acceptances` row and its `consent_events` mirror — with
       * the terms version, a timestamp and an IP hash — when the emailed link
       * is opened. Clicking that link *is* the acceptance, and it is the only
       * event with a version attached to it.
       *
       * So the card says what the landing form says: you will accept in the
       * next step. One sentence that is true beats a checkbox that looks like
       * a gate and is not one.
       */}
      <form action={requestSignupAction} noValidate>
        <Stack gap="md">
          {/* Known at render time, so the page stays static. Re-resolved
              server-side against the live template table regardless. */}
          <input type="hidden" name="tjenestemal" value={templateSlug} />
          {landsdelSlug ? <input type="hidden" name="landsdel" value={landsdelSlug} /> : null}
          <Field id="e-post-inline" label={SIGNUP_EMAIL_LABEL} hint={SIGNUP_EMAIL_HINT} required>
            {(controlProps) => (
              <Input
                {...controlProps}
                name="epost"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="navn@virksomhet.no"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" fullWidth>
            {SIGNUP_SUBMIT}
          </Button>
          <p className="m-0 text-sm text-text-muted">
            Gratis, ingen kortopplysninger. Du godtar <Link href="/vilkar">bruksvilkårene</Link> når
            du åpner lenken vi sender, og kan lese{' '}
            <Link href="/personvern">personvernerklæringen</Link> først.
          </p>
        </Stack>
      </form>
    </section>
  );
}
