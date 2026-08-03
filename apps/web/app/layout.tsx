import '@luma/ui/tokens.css';
import '@luma/ui/styles.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Poppins } from 'next/font/google';
import { buttonClassName, Cluster, SkipLink } from '@luma/ui';
import { privacyPolicyUrl } from '@/lib/legal';
import { lumaUrl } from '@/lib/luma-links';
import { SERVICE_NAME, SERVICE_TAGLINE } from '@/content/copy';

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
  metadataBase: new URL('https://anbudsvarsling.luma-training.com'),
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb" className={poppins.variable}>
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
      <Image
        src="/luma-logo-orange-transparent.png"
        alt=""
        width={273}
        height={164}
        className="site-brand__logo"
        priority
      />
      {/* Name only. `SERVICE_TAGLINE` is the hero's eyebrow and the footer's
          first sentence; a third copy in the chrome on every page reads as a
          slogan rather than as the fact it is. */}
      <span className="site-brand__name">{SERVICE_NAME}</span>
    </Link>
  );
}

function SiteHeader() {
  return (
    <header className="site-header">
      {/* Wraps to two rows on a narrow screen rather than collapsing into a
          hamburger. Three destinations do not earn a disclosure widget, and a
          menu that needs JavaScript to open is a menu that can fail to open. */}
      <div className="app-shell flex flex-wrap items-center justify-between gap-sm py-sm">
        <BrandLockup />
        <Cluster as="nav" gap="xs" aria-label="Hovedmeny">
          <Link href="/koble-til-ai" className="site-nav-link">
            Koble til AI
          </Link>
          <Link href="/logg-inn" className="site-nav-link">
            Logg inn
          </Link>
          <Link
            href="/#registrering"
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          >
            Kom i gang
          </Link>
        </Cluster>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer mt-3xl py-xl">
      <div className="app-shell flex flex-col gap-lg">
        <div className="flex flex-wrap items-start justify-between gap-lg">
          <div className="flex flex-col gap-xs">
            <Image
              src="/luma-logo-orange-transparent.png"
              alt="Luma Training"
              width={273}
              height={164}
              className="site-brand__logo"
            />
            {/* Two sentences rather than one, because the previous wording
                lower-cased `SERVICE_TAGLINE` to splice it into a clause and
                printed the company as "luma training". */}
            <p className="m-0 font-semibold">{SERVICE_NAME}</p>
            <p className="prose-measure m-0 text-sm text-text-muted">
              {SERVICE_TAGLINE}. Kildedata kommer fra Doffin.
            </p>
          </div>
          <Cluster as="nav" gap="md" aria-label="Bunnmeny" className="text-sm">
            <Link href="/personvern">Personvern</Link>
            <Link href="/vilkar">Bruksvilkår</Link>
            <a href={privacyPolicyUrl()}>Luma Trainings personvernerklæring</a>
            <a href={lumaUrl('/', { medium: 'nettsted', content: 'bunnmeny' })}>Luma Training</a>
          </Cluster>
        </div>
      </div>
    </footer>
  );
}
