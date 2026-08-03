import '@luma/ui/tokens.css';
import '@luma/ui/styles.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Poppins } from 'next/font/google';
import { Cluster, SkipLink } from '@luma/ui';
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
        <main id="hovedinnhold" className="app-shell py-xl">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface-raised">
      <div className="app-shell flex flex-wrap items-center justify-between gap-sm py-sm">
        <Link href="/" className="site-nav-link">
          <span className="flex flex-col">
            <span className="text-lg font-semibold text-text">{SERVICE_NAME}</span>
            <span className="text-xs text-text-muted">{SERVICE_TAGLINE}</span>
          </span>
        </Link>
        <Cluster as="nav" gap="xs" aria-label="Hovedmeny">
          <Link href="/koble-til-ai" className="site-nav-link">
            Koble til AI
          </Link>
          <Link href="/logg-inn" className="site-nav-link">
            Logg inn
          </Link>
        </Cluster>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-3xl border-t border-line bg-surface-raised py-xl">
      <div className="app-shell flex flex-col gap-sm text-sm text-text-muted">
        <p className="m-0">
          {SERVICE_NAME} er {SERVICE_TAGLINE.toLowerCase()}. Kildedata kommer fra Doffin.
        </p>
        <Cluster as="nav" gap="md" aria-label="Bunnmeny">
          <Link href="/personvern">Personvern</Link>
          <Link href="/vilkar">Bruksvilkår</Link>
          <a href={privacyPolicyUrl()}>Luma Trainings personvernerklæring</a>
          <a href={lumaUrl('/', { medium: 'nettsted', content: 'bunnmeny' })}>Luma Training</a>
        </Cluster>
      </div>
    </footer>
  );
}
