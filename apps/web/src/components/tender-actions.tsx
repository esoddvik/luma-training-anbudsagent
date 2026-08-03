import { Button, Cluster } from '@luma/ui';
import {
  createShareAction,
  dismissTenderAction,
  resetTenderStateAction,
  saveTenderAction,
} from '@/server/actions/tender-actions';
import type { UserTenderState } from '@/server/tenders';

/**
 * Save, dismiss and share buttons.
 *
 * Each button is its own `<form>` posting to a server action. That is more
 * markup than one form with several submit buttons, but it is what makes the
 * controls work with JavaScript disabled *and* keeps each button's accessible
 * name equal to what it does — a `formAction` on a shared form gives assistive
 * technology a submit control whose behaviour depends on which one was pressed.
 */

export interface TenderActionsProps {
  readonly tenderId: string;
  readonly state: UserTenderState;
  /** Where the action should send the browser afterwards. */
  readonly returnTo: string;
  /** Hidden when the user already has a live link for this tender. */
  readonly canShare?: boolean;
}

export function TenderActions({ tenderId, state, returnTo, canShare = true }: TenderActionsProps) {
  return (
    <Cluster gap="xs">
      {state === 'saved' ? (
        <ActionForm
          action={resetTenderStateAction}
          tenderId={tenderId}
          returnTo={returnTo}
          label="Fjern fra lagrede"
          variant="ghost"
        />
      ) : (
        <ActionForm
          action={saveTenderAction}
          tenderId={tenderId}
          returnTo={returnTo}
          label="Lagre anbudet"
          variant="secondary"
        />
      )}

      {state === 'dismissed' ? (
        <ActionForm
          action={resetTenderStateAction}
          tenderId={tenderId}
          returnTo={returnTo}
          label="Angre avvisning"
          variant="ghost"
        />
      ) : (
        <ActionForm
          action={dismissTenderAction}
          tenderId={tenderId}
          returnTo={returnTo}
          label="Avvis anbudet"
          variant="ghost"
        />
      )}

      {canShare ? (
        <ActionForm
          action={createShareAction}
          tenderId={tenderId}
          returnTo={returnTo}
          label="Del internt"
          variant="secondary"
        />
      ) : null}
    </Cluster>
  );
}

function ActionForm({
  action,
  tenderId,
  returnTo,
  label,
  variant,
}: {
  readonly action: (formData: FormData) => Promise<void>;
  readonly tenderId: string;
  readonly returnTo: string;
  readonly label: string;
  readonly variant: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <form action={action}>
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
    </form>
  );
}
