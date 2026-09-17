'use client';

// Error boundary dei monitor e del tabellone. Uno schermo appeso al muro non ha nessuno che
// prema "Riprova": se il rendering va in errore, si mostra un avviso leggibile da lontano e si
// riprova da soli dopo pochi secondi. Meglio un giallo esplicito che uno schermo bianco, che in
// sala d'attesa viene letto come "il sistema è rotto".
import { useEffect } from 'react';

const RETRY_AFTER_MS = 20_000;

export default function DisplayError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(reset, RETRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [reset]);

  return (
    <div
      role="alert"
      className="bg-status-in-progress-soft0 flex h-screen w-screen flex-col items-center justify-center text-center text-slate-950"
    >
      <p className="text-[7vw] leading-none font-black">MONITOR IN RIPRISTINO</p>
      <p className="mt-[2vh] text-[2.5vw] font-semibold">
        Lo schermo si riavvia da solo fra pochi secondi. Per il turno rivolgersi
        all&apos;accettazione.
      </p>
      <p className="mt-[3vh] font-mono text-[1.4vw] opacity-70">
        codice {error.digest ?? 'n/d'} · {error.name}
      </p>
    </div>
  );
}
