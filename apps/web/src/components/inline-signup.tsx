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
    <section aria-labelledby="varsling-tittel" className="prose-measure" id="registrering">
      <Stack gap="md">
        <h2 id="varsling-tittel" className="section-heading">
          Få disse på e-post
        </h2>
        <p className="m-0">
          Vi følger med på nye kunngjøringer for {templateName.toLowerCase()}
          {landsdelName ? ` i ${landsdelName}` : ''} og sender deg treffene. Gratis. Profilen
          starter på pause, så du rekker å se over kriteriene før det første varselet går ut.
        </p>
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
            <div className="flex">
              <Button type="submit" variant="primary">
                {SIGNUP_SUBMIT}
              </Button>
            </div>
          </Stack>
        </form>
      </Stack>
    </section>
  );
}
