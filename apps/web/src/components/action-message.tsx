import { Alert } from '@luma/ui';
import { resolveActionMessage } from '@/server/actions/messages';

/**
 * The confirmation banner after a server action.
 *
 * Forms in this app work without client JavaScript, so an action redirects with
 * a short code and the page renders it here. `live="polite"` makes the
 * announcement reach a screen reader without stealing focus, which is the
 * accessible equivalent of the toast a client-side app would show.
 */
export function ActionMessage({ code }: { readonly code: string | string[] | undefined }) {
  const message = resolveActionMessage(code);
  if (!message) return null;

  return (
    <Alert tone={message.tone} live="polite">
      <p className="m-0">{message.text}</p>
    </Alert>
  );
}
