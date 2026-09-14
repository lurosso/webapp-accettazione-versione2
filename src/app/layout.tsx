// Layout radice dell'App Router: lingua italiana, stili globali, font di sistema, provider client.
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
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
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
