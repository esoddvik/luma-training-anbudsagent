import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert, Button, Card, Stack } from '@luma/ui';
import { acceptTermsAction } from '@/server/actions/legal-actions';
import { getWebDb } from '@/server/db';
import { parseLegalBody } from '@/server/legal-body';
import { outstandingTerms } from '@/server/legal';
import { requireUser } from '@/server/session';
import { safeReturnPath } from '@/lib/return-path';
import { SignOutForm } from '../../../(app)/_components/sign-out-form';

export const metadata: Metadata = {
  title: 'Nye bruksvilkår',
};

/**
 * The outstanding terms acceptance (spec section 20.1, section 51 blocker 2).
 *
 * Reached by redirect from the gate. It lives in `(konto)` rather than `(app)`
 * for the obvious reason: a page that the gate redirected to, which is itself
 * gated, is an infinite redirect.
 *
 * ## What it shows
 *
 * The body of the version actually in force, read from the database and passed
 * to the action as a hidden field. The user accepts the text on the screen in
 * front of them — not "the current version", which could have changed between
 * this render and the button. `acceptTermsAction` explains why that matters.
 *
 * ## Why sign-out is on this page
 *
 * Because the honest answer to "I do not accept these terms" cannot be "then
 * you are stuck here". Deleting the account is one way out and must not be the
 * only one, so signing out is offered on the same screen that is asking.
 */
export default async function GodtaVilkarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const retur = safeReturnPath(typeof params['retur'] === 'string' ? params['retur'] : undefined);

  const outstanding = await outstandingTerms(getWebDb(), user.id);

  // Nothing owed. Somebody bookmarked this, pressed back, or accepted in
  // another tab — none of which should show a form asking them to accept
  // something they already have.
  if (!outstanding) redirect(retur ?? '/oversikt');

  return (
    <Stack gap="lg">
      <h1 className="page-heading">Vi har oppdatert bruksvilkårene</h1>

      <Alert tone="info" heading="Du må godta de nye vilkårene for å fortsette" titleLevel={2}>
        <p className="m-0 prose-measure">
          Vilkårene for Luma Anbudsvarsling er endret. Les dem gjennom og godta for å bruke
          tjenesten videre. Du kan når som helst laste ned dataene dine eller slette kontoen din
          uten å godta.
        </p>
      </Alert>

      <p className="m-0 text-sm text-text-muted">
        Versjon {outstanding.version}, gjelder fra{' '}
        {outstanding.effectiveFrom.toLocaleDateString('nb-NO')}.
      </p>

      <Card as="section" heading="Bruksvilkår" titleLevel={2}>
        <Stack gap="md" className="prose-measure">
          {parseLegalBody(outstanding.body).map((block, index) =>
            block.type === 'heading' ? (
              <h3 key={index} className="section-heading">
                {block.text}
              </h3>
            ) : (
              <p key={index} className="m-0">
                {block.text}
              </p>
            ),
          )}
        </Stack>
      </Card>

      <form action={acceptTermsAction}>
        {/* The version the reader was actually shown, not whatever is newest
            when they press the button. */}
        <input type="hidden" name="versjon" value={outstanding.version} />
        {retur ? <input type="hidden" name="retur" value={retur} /> : null}
        <Button type="submit">Jeg godtar de nye vilkårene</Button>
      </form>

      <Stack gap="sm">
        <p className="m-0 text-sm text-text-muted">
          Vil du ikke godta? Du kan <a href="/innstillinger/eksport">laste ned dataene dine</a>{' '}
          eller <a href="/innstillinger/slett-konto">slette kontoen din</a>.
        </p>
        <SignOutForm />
      </Stack>
    </Stack>
  );
}
