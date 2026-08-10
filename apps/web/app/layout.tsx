import '@luma/ui/tokens.css';
// `@luma/ui/styles.css` is imported from `globals.css`, not here: it has to be
// assigned to Tailwind's `components` layer, and only that file knows the layer
// order. See the note above the import there before moving it back.
import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Poppins } from 'next/font/google';
import { buttonClassName, SkipLink } from '@luma/ui';
import { privacyPolicyUrl } from '@/lib/legal';
import { lumaUrl } from '@/lib/luma-links';
import { basePathed, PRODUCTION_URL } from '@/lib/site';
import { SERVICE_NAME } from '@/content/copy';

/**
 * The logo, addressed with the base path in front of it.
 *
 * `next/image` is the one place `basePath` is **not** applied for you: Next's
 * own reference says the prefix has to be in `src`. Without it the optimiser is
 * handed `/luma-logo-orange-transparent.png`, which is not a path this app
 * serves any more — public files sit under the prefix too — and answers 400.
 * Verified both ways against the running server; the only symptom is a missing
 * logo in the header and the footer.
 */
const LOGO_SRC = basePathed('/luma-logo-orange-transparent.png');

/** The licence the Doffin/DFØ announcement data is republished under. */
const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/deed.no';

/**
 * Poppins is Luma Training's typeface (luma-training.com loads 400/500/600/700).
 *
 * Loaded through `next/font` rather than the `@import url(fonts.googleapis.com)`
 * the marketing site uses: that import is render-blocking, and it makes every
 * visitor's browser contact Google on page load, which is a third-party request
 * this service would have to account for under section 18. `next/font`
 * self-hosts the files at build time, so neither applies.
 *
 * `display: swap` keeps text readable while the face loads, and the fallback
 * chain in `--luma-font-sans` is what shows in that window.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--luma-font-poppins',
});

export const metadata: Metadata = {
  // Carries the base path, so every relative URL Next resolves against it —
  // canonicals above all — lands inside the zone. Next joins `metadataBase`'s
  // pathname with the relative value rather than calling `new URL(path, base)`,
  // which would drop it (`resolve-url.ts`, checked in the installed version).
  metadataBase: new URL(PRODUCTION_URL),
  title: {
    default: `${SERVICE_NAME} — gratis varsling om offentlige anbud`,
    template: `%s | ${SERVICE_NAME}`,
  },
  description:
    'Få beskjed når relevante offentlige anbud publiseres på Doffin. Luma Anbudsvarsling sender deg treff som passer varslingsprofilen din, og varsler om planlagte anskaffelser. Gratis, fra Luma Training.',
  applicationName: SERVICE_NAME,
  authors: [{ name: 'Luma Training' }],
  openGraph: {
    type: 'website',
    locale: 'nb_NO',
    siteName: SERVICE_NAME,
    title: `${SERVICE_NAME} — gratis varsling om offentlige anbud`,
    description:
      'Fortell oss hvilke oppdrag virksomheten din ser etter, så sier vi fra når relevante anbud publiseres.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * `data-theme="light"` pins the palette.
 *
 * The tokens carry a full dark scale and honour `prefers-color-scheme`, but
 * luma-training.com has no dark mode: it is cream, white and orange in every
 * browser. A visitor arriving from the marketing site with dark mode on got a
 * near-black page carrying Luma's logo, which reads as a different company
 * rather than as the same one after dark. `data-theme` is the escape hatch
 * tokens.css documents for exactly this; the dark blocks stay in place and
 * come back the moment the attribute is removed.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb" data-theme="light" className={poppins.variable}>
      <body>
        <SkipLink />
        <SiteHeader />
        {/* `site-main` centres each direct child at the shell width and lets one
            opt out with `bleed` — see globals.css. The landmark and its id stay
            exactly where they were, so the skip link still lands here. */}
        <main id="hovedinnhold" className="site-main">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}

/**
 * The logo lockup.
 *
 * The mark is Luma Training's; the name beside it is this service's. Keeping
 * both visible is the honest version of the relationship — the service is free
 * and it is Luma's, and section 42 asks for that to be said plainly rather than
 * implied by borrowed branding.
 *
 * The image is `alt=""` because the text beside it already carries the name;
 * captioning it "Luma Training" as well would make the link announce the brand
 * twice.
 */
function BrandLockup() {
  return (
    <Link href="/" className="site-brand">
      <Image src={LOGO_SRC} alt="" width={273} height={164} className="site-brand__logo" priority />
      {/* Name only. `SERVICE_TAGLINE` is the hero's eyebrow and the footer's
          first sentence; a third copy in the chrome on every page reads as a
          slogan rather than as the fact it is. */}
      <span className="site-brand__name">{SERVICE_NAME}</span>
    </Link>
  );
}

/**
 * The four destinations, rendered into whichever of the two navs is visible.
 *
 * The picker is the top of the funnel, so it belongs in the chrome and not only
 * in the hero: someone who lands three pages deep from a search result has no
 * other way back to it.
 */
function NavDestinations() {
  return (
    <>
      <Link href="/finn-anbud" className="site-nav-link">
        Finn anbud
      </Link>
      <Link href="/ai-verktoy" className="site-nav-link">
        AI-verktøy
      </Link>
      <Link href="/logg-inn" className="site-nav-link">
        Logg inn
      </Link>
      <Link href="/#registrering" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
        Kom i gang
      </Link>
    </>
  );
}

/**
 * ## Why there are two navs and only ever one landmark
 *
 * This used to be one wrapping `Cluster`, on the reasoning that three
 * destinations do not earn a disclosure widget and that a menu needing
 * JavaScript to open is a menu that can fail to open. The second half of that
 * is still true and is why there is no client component here. The first half
 * did not survive being looked at on a phone: at 390 the row wrapped three
 * deep — brand, then links, then the pill — and ate the top 360 pixels before
 * any content, so the chrome was the page.
 *
 * `<details>` is the fix that keeps the argument intact. It is native HTML, it
 * opens with the bundle stripped, and it needs no state.
 *
 * The links appear twice in the markup, once per breakpoint, and exactly one of
 * the two containers is ever `display: none`. That matters: `display: none`
 * removes a subtree from the accessibility tree outright, so a screen reader
 * meets one «Hovedmeny» landmark and one set of links, never two — and the
 * hidden copy holds nothing focusable, which is what keeps the skip link first
 * in the tab order.
 */
function SiteHeader() {
  return (
    <header className="site-header">
      <div className="app-shell flex items-center justify-between gap-sm py-md">
        <BrandLockup />

        {/* Deliberately NOT a `Cluster`. `.luma-cluster` is unlayered CSS and
            sets `display: flex`, which outranks Tailwind's `hidden` sitting in
            `@layer utilities` — so the wide nav stayed visible at 390 and the
            page carried two menus. Both breakpoints are driven from
            `.site-nav` / `.site-menu` in globals.css, where nothing competes. */}
        <nav className="site-nav" aria-label="Hovedmeny">
          <NavDestinations />
        </nav>

        <details className="site-menu">
          <summary className="site-menu__toggle" aria-label="Meny">
            <span className="site-menu__bars" aria-hidden="true" />
          </summary>
          <nav className="site-menu__panel" aria-label="Hovedmeny">
            <NavDestinations />
          </nav>
        </details>
      </div>
    </header>
  );
}

/**
 * luma-training.com's footer, rebuilt here.
 *
 * The marketing site ends every page on a solid orange band: the white
 * wordmark on the left, a single column of plain links set well in from it,
 * nothing else. No tagline, no columns, no small print. Reproduced to the same
 * shape so a visitor who arrives from luma-training.com lands on a page that
 * ends the way the one they came from does.
 *
 * The destinations are this service's own, not the marketing site's. Its
 * footer links to `/kjopsvilkar` and `/bedriftsinterne-kurs`, which are pages
 * about buying a course; this app has to keep its own privacy notice and terms
 * one click from every page, so those take the first two slots and Luma's own
 * privacy notice and front page follow.
 *
 * The mark is the orange logo inverted to white in CSS rather than a second
 * asset, so there is one logo file in `public/` and it cannot go out of sync
 * with itself.
 */
function SiteFooter() {
  return (
    <footer className="site-footer mt-3xl py-2xl">
      <div className="app-shell flex flex-col gap-lg">
        <div className="flex flex-col gap-lg md:flex-row md:gap-3xl">
          <Image
            src={LOGO_SRC}
            alt="Luma Training"
            width={273}
            height={164}
            className="site-footer__logo"
          />
          <nav aria-label="Bunnmeny" className="flex flex-col gap-sm md:ms-3xl">
            <Link href="/personvern" className="site-footer__link">
              Retningslinjer for personvern
            </Link>
            <Link href="/vilkar" className="site-footer__link">
              Bruksvilkår
            </Link>
            <a href={privacyPolicyUrl()} className="site-footer__link">
              Luma Trainings personvernerklæring
            </a>
            <a
              href={lumaUrl('/', { medium: 'nettsted', content: 'bunnmeny' })}
              className="site-footer__link"
            >
              Luma Training
            </a>
          </nav>
        </div>
        {/*
         * The CC BY attribution, in the chrome rather than on each page.
         *
         * Every public surface republishes announcement data, so the notice has
         * to be within a glance of all of them; putting it in the footer is how
         * it stays there when a new page is added. The pages that carry it
         * themselves keep it — a reader looking at a list of notices should not
         * have to scroll to the end of the site to learn where they came from.
         *
         * ADR-0018 fixes the wording, so the rendered text reads exactly
         * `Data: Doffin/DFØ (CC BY 4.0)` and the licence name carries the link.
         */}
        <p className="site-footer__note">
          Data: Doffin/DFØ (
          <a href={LICENCE_URL} className="site-footer__link">
            CC BY 4.0
          </a>
          )
        </p>
      </div>
    </footer>
  );
}
