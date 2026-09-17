'use client';

// Error boundary dell'area operatore. Un errore di rendering in una schermata non deve buttare
// fuori chi lavora: si spiega cosa è successo, si offre "Riprova" e la via verso la coda, che è
// il posto dove l'accettatore deve poter tornare sempre. L'intestazione resta al suo posto perché
// questo file vive dentro il layout dell'area, non sopra.
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function OperatorError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-status-no-show/30 bg-status-no-show-soft mx-auto flex max-w-2xl flex-col gap-4 rounded-xl border px-6 py-8"
    >
      <div>
        <h1 className="text-status-no-show-ink text-xl font-bold">
          Questa schermata ha avuto un problema
        </h1>
        <p className="text-status-no-show-ink mt-1 text-sm">
          Il resto dell&apos;applicazione funziona: la coda, i monitor e il portale non sono
          coinvolti. Riprova; se succede ancora, torna alla coda e segnala al responsabile il codice
          qui sotto.
        </p>
      </div>
      <p className="text-status-no-show-ink font-mono text-xs">
        Codice: {error.digest ?? 'n/d'} · {error.name}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reset}>Riprova</Button>
        <Link
          href="/accettazione"
          className="border-line text-ink premibile focus-anello controllo inline-flex items-center rounded-md border bg-white px-4 text-sm font-semibold hover:bg-slate-50"
        >
          Torna alla coda
        </Link>
      </div>
    </div>
  );
}
