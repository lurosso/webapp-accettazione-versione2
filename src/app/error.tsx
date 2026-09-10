'use client';

// Error boundary radice dell'App Router (Client Component obbligatorio per Next.js).
// Sostituisce la pagina generica in inglese di Next con un messaggio in italiano e un pulsante
// "Riprova"; i dettagli completi restano nei log del server. Gli `ErrorBoundary` per modulo
// (dashboard, portale, display) arrivano con le rispettive milestone (ARCHITECTURE.md §6.6).

export default function RootError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-red-900">Si è verificato un errore</h1>
      <p className="text-slate-700">
        La pagina non può essere visualizzata. Riprovare; se il problema persiste, contattare il
        responsabile del sistema indicando il codice riportato sotto.
      </p>
      <p className="font-mono text-xs text-slate-500">
        Codice: {error.digest ?? 'n/d'} · {error.name}
      </p>
      <button
        type="button"
        onClick={reset}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
      >
        Riprova
      </button>
    </main>
  );
}
