// Layout radice dell'App Router: lingua italiana, caratteri, stili globali, provider client.
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
/*
 * Caratteri serviti dal nostro dominio, non da Google Fonts.
 *
 * I file arrivano da un pacchetto npm (Fontsource) e finiscono nel bundle: la build non chiama
 * nessun server esterno e il browser nemmeno. È la stessa regola del resto del sistema —
 * l'officina non deve mai bloccarsi — applicata al testo: una postazione dietro il firewall
 * aziendale, o una build fatta su una macchina senza uscita su Internet, non devono ritrovarsi
 * con i caratteri di ripiego e le colonne disallineate. `next/font/google` avrebbe scaricato i
 * file in fase di build, e sarebbe bastata una build offline per rompere tutto.
 *
 * Sans variabile (un solo file per tutti i pesi da 100 a 700), Mono nei tre pesi che usiamo
 * davvero per targhe, codici pratica e orari.
 */
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'Gestione Accettazione e Flussi Officina',
    template: '%s · Accettazione Officina',
  },
  description: "Web app operatore, portale cliente e monitor di accettazione per l'officina.",
  // Aggiunta alla schermata iniziale del tablet, l'app si apre senza la cornice del browser.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Check-in', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#00466f',
  // Consente ai comandi fissi del check-in di rispettare la tacca e la barra dei gesti del tablet.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="it">
      <body className="bg-surface-app text-ink min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
