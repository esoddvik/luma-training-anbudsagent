import { Alert, Badge, Card, Cluster, Stack } from '@luma/ui';
import type { FullMatchExplanation } from '@/server/match-explanation';

/**
 * The "why did I get this" block (spec section 4.2).
 *
 * Section 4.2 requires the service to be able to show the matching CPV codes,
 * keywords, geography, buyer, value range and competition type, any exclusion
 * rule that fired, a human-readable explanation, and the line between rule-based
 * matching and AI interpretation. All of that is in the stored reasons, so this
 * component renders them rather than composing new prose.
 *
 * The relevance band is shown with the approved wording and the disclaimer
 * immediately beside it. There is no percentage anywhere: section 4.3 forbids
 * presenting a score as a probability of winning, and the surest way not to is
 * never to render the number.
 */

export function MatchExplanationCard({
  explanation,
  profileName,
  included,
}: {
  readonly explanation: FullMatchExplanation;
  readonly profileName: string;
  readonly included: boolean;
}) {
  return (
    <Card as="section" heading={`Hvorfor dette anbudet passer «${profileName}»`} titleLevel={2}>
      <Stack gap="md">
        <Cluster gap="xs">
          <Badge variant={included ? 'treff' : 'neutral'}>{explanation.confidenceText}</Badge>
          {included ? null : <Badge variant="warning">Holdt utenfor varslene</Badge>}
        </Cluster>

        <p className="m-0 text-sm text-text-muted">{explanation.disclaimer}</p>

        {explanation.reasons.length === 0 ? (
          <p className="m-0">
            Vi har ingen lagret begrunnelse for dette treffet. Det skjer hvis treffet ble laget med
            en eldre regelversjon.
          </p>
        ) : (
          <div>
            <h3 className="m-0 text-base font-semibold">Dette er grunnlaget for treffet</h3>
            <Stack as="ul" gap="xs" className="m-0 mt-xs list-none p-0">
              {explanation.reasons.map((reason) => (
                <li key={`${reason.type}-${reason.label}`}>
                  <p className="m-0 font-medium">{reason.label}</p>
                  {reason.evidence.length === 0 ? null : (
                    <p className="m-0 text-sm text-text-muted">{reason.evidence.join('; ')}</p>
                  )}
                </li>
              ))}
            </Stack>
          </div>
        )}

        {explanation.exclusions.length === 0 ? null : (
          <Alert tone="warning" heading="Dette holdt anbudet utenfor" titleLevel={3}>
            <Stack as="ul" gap="xs" className="m-0 list-none p-0">
              {explanation.exclusions.map((exclusion) => (
                <li key={`${exclusion.type}-${exclusion.label}`}>
                  <p className="m-0 font-medium">{exclusion.label}</p>
                  {exclusion.evidence.length === 0 ? null : (
                    <p className="m-0 text-sm">{exclusion.evidence.join('; ')}</p>
                  )}
                </li>
              ))}
            </Stack>
          </Alert>
        )}

        <p className="m-0 text-sm text-text-muted">{explanation.method}</p>
        <p className="m-0 text-xs text-text-muted">Regelversjon: {explanation.matchingVersion}</p>
      </Stack>
    </Card>
  );
}
