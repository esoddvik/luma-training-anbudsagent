import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'MCP',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="MCP"
      lede="Bruk av MCP-serveren: aktive tokener, verktøykall og mulighet for å tilbakekalle tilgang."
      note="Kobles til MCP-serverens logg."
    />
  );
}
