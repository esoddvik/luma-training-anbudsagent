import { signOutAction } from '@/server/actions/session-actions';

/**
 * The sign-out control (spec section 10).
 *
 * A plain form posting a server action, so it works with no client
 * JavaScript — like every other form in this app, and more importantly here
 * than most: this is one of the three ways out of the terms gate, and a way
 * out that depends on a script loading is not one.
 *
 * Rendered by the signed-in layout and by the re-acceptance page. The page
 * needs its own copy because it sits outside `(app)`, and a user who declines
 * the new terms has to be able to leave from the screen that is asking.
 */
export function SignOutForm({ className }: { className?: string }) {
  return (
    <form action={signOutAction} className={className}>
      <button
        type="submit"
        className="min-h-[44px] cursor-pointer border-0 bg-transparent p-0 text-sm text-text-muted underline"
      >
        Logg ut
      </button>
    </form>
  );
}
