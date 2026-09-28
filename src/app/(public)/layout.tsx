// Layout del portale cliente: area pubblica raggiunta dal QR code all'ingresso delle corsie e dal
// link WhatsApp. Mobile, senza navigazione operatore e senza dati personali. Solo il marchio in
// alto e, in fondo, a chi rivolgersi (M8-T56: testi grandi, nient'altro).
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/layout/BrandMark';

export default function PublicLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="bg-surface-app flex min-h-screen flex-col">
      <header className="border-brand-lime bg-brand-blue-dark border-b-4 text-white">
        <div className="mx-auto flex max-w-xl items-center justify-center px-5 py-4">
          <BrandMark tone="light" className="text-2xl" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">{children}</main>
      <footer className="text-ink-muted mx-auto w-full max-w-xl px-5 pb-8 text-center text-lg">
        Per aiuto si rivolga all&apos;accettazione.
      </footer>
    </div>
  );
}
