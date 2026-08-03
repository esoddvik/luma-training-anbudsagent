# apps/web

The Next.js App Router application: public pages, the logged-in dashboard, the shared tender view and the admin surfaces. Deployed to Vercel (ADR-0001).

## Running it locally

```bash
pnpm --filter web dev
```

Next reads environment from **`apps/web/`, not the repository root**. The root `.env` is what `apps/core` and `apps/mcp` load through `@luma/config`, and it does nothing here. Without `apps/web/.env.local`, every logged-in page returns 500 with «DATABASE_URL mangler» while the public pages render fine — so the app looks healthy until you sign in.

Copy the values you need from `.env.example`. `apps/web/.env.local` is gitignored.

## Styling

Colour, spacing, radius and elevation all come from `@luma/ui` tokens. Tailwind's default palette is deliberately disabled in `app/globals.css` (`--color-*: initial`), so `bg-slate-500` does not exist. If you need a colour with no token, add the token rather than a hex literal — there is a test asserting `@luma/ui`'s stylesheet contains no hex, and no equivalent guard inside this app.

`bg-brand` is Luma's signature orange and is for decorative surfaces only. `text-brand` and `border-brand` also exist, because Tailwind v4 mints the whole utility family from one `--color-*` declaration, and both render `#FF6B35` as a foreground at 2.84:1 — failing WCAG AA. An eslint rule in the root config rejects them; use `text-primary` for text, or `bg-brand` with `text-brand-on`.

`@luma/ui/styles.css` is **unlayered**, so `.luma-*` rules beat Tailwind utilities at equal specificity. `<Card tone="flat" className="shadow-md">` silently renders with no shadow.

## Verifying UI changes in this environment

**A CSS transition never advances when the Browser pane is not compositing frames.** Reading a transitioned property with `getComputedStyle` then returns its `t=0` value indefinitely — for `box-shadow` that is `rgba(0,0,0,0) 0 0 0 0`, which reads exactly like the rule not existing. `setTimeout` does not help; timers fire without frames being rendered.

This has already produced one near-miss bug report against a feature that worked. Before measuring a hover or focus style:

```js
el.style.transition = 'none';
```

Static measurements — colour, contrast, radius, geometry, hit-testing, heading order — are unaffected and trustworthy.

The stronger version of the same warning: the tests in `@luma/ui` read CSS *text*. They prove a declaration exists and is scoped correctly. They cannot prove a transitioned property ever reaches its target in a real browser, and neither can a computed-style read taken here. Some of this app's visual behaviour is therefore verified by measurement and reasoning rather than by anyone having looked at it.
