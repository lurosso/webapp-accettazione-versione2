'use client';

// Error boundary del check-in: sul piazzale non c'è l'intestazione da cui tornare indietro, quindi
// la schermata di errore deve offrire da sola il ritorno alla coda, con pulsanti grandi.
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function CheckInError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-6 py-10">
      <div
        role="alert"
        className="border-status-no-show/30 bg-status-no-show-soft rounded-2xl border-2 px-6 py-8"
      >
        <h1 className="text-status-no-show-ink text-2xl font-bold">
          Il check-in ha avuto un problema
        </h1>
        <p className="text-status-no-show-ink mt-2 text-base">
          La pratica e le foto già salvate non si perdono. Riprova, oppure torna alla coda: il
          check-in si riprende da &ldquo;Le mie prese in carico&rdquo;.
        </p>
        {error.digest !== undefined ? (
          <p className="text-status-no-show-ink mt-3 font-mono text-xs">Codice: {error.digest}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        <Button size="lg" onClick={reset}>
          Riprova
        </Button>
        <Link
          href="/accettazione"
          className="border-line text-ink-soft premibile focus-anello controllo-lg inline-flex items-center justify-center rounded-xl border-2 bg-white px-4 text-lg font-semibold"
        >
          Torna alla coda
        </Link>
      </div>
    </main>
  );
}
