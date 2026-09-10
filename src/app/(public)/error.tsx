'use client';

// Error boundary del portale cliente: se un componente fallisce, il cliente vede un messaggio
// comprensibile e può ripartire dalla ricerca, senza dettagli tecnici.
import Link from 'next/link';

export default function PublicError({ reset }: { readonly reset: () => void }) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-4 rounded-2xl border-2 border-slate-300 bg-white p-6 text-center shadow-sm"
    >
      <h1 className="text-2xl font-bold text-slate-900">
        Servizio momentaneamente non disponibile
      </h1>
      <p className="text-lg text-slate-700">
        Non riusciamo a mostrare lo stato della coda. Riprova fra qualche istante oppure rivolgiti
        allo sportello dell&apos;accettazione.
      </p>
      <button
        type="button"
        onClick={reset}
        className="h-touch mx-auto w-full max-w-xs rounded-xl bg-slate-900 px-6 text-lg font-semibold text-white hover:bg-slate-700 focus-visible:ring-4 focus-visible:ring-slate-400 focus-visible:outline-none"
      >
        Riprova
      </button>
      <Link
        href="/cliente"
        className="text-base font-medium text-slate-600 underline hover:text-slate-900"
      >
        Torna alla ricerca targa
      </Link>
    </section>
  );
}
