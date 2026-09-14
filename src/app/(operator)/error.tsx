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
      className="mx-auto flex max-w-2xl flex-col gap-4 rounded-xl border border-red-200 bg-red-50 px-6 py-8"
    >
      <div>
        <h1 className="text-xl font-bold text-red-900">Questa schermata ha avuto un problema</h1>
        <p className="mt-1 text-sm text-red-800">
          Il resto dell&apos;applicazione funziona: la coda, i monitor e il portale non sono
          coinvolti. Riprova; se succede ancora, torna alla coda e segnala al responsabile il codice
          qui sotto.
        </p>
      </div>
      <p className="font-mono text-xs text-red-700">
        Codice: {error.digest ?? 'n/d'} · {error.name}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reset}>Riprova</Button>
        <Link
          href="/accettazione"
          className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Torna alla coda
        </Link>
      </div>
    </div>
  );
}
