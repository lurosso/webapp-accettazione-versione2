// Layout radice dell'App Router: lingua italiana, stili globali, font di sistema.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gestione Accettazione e Flussi Officina',
  description: "Web app operatore, portale cliente e display campate per l'accettazione in officina.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="it">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}
