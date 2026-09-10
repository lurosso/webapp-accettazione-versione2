// Layout del portale cliente: area pubblica raggiunta dal QR code all'ingresso delle corsie.
// Mobile-first, senza navigazione operatore e senza dati personali.
import type { ReactNode } from 'react';

export default function PublicLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between px-5 py-3">
          <span className="text-sm font-bold tracking-wide text-slate-500 uppercase">
            Autoclub Group
          </span>
          <span className="text-sm text-slate-500">Accettazione officina</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-8">{children}</main>
      <footer className="mx-auto w-full max-w-xl px-5 pb-8 text-center text-sm text-slate-500">
        Per assistenza rivolgiti allo sportello dell&apos;accettazione.
      </footer>
    </div>
  );
}
