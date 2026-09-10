// Layout radice dell'App Router: lingua italiana, stili globali, font di sistema, provider client.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'Gestione Accettazione e Flussi Officina',
    template: '%s · Accettazione Officina',
  },
  description: "Web app operatore, portale cliente e display campate per l'accettazione in officina.",
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
