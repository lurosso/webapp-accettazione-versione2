'use client';

// Schermata a tutto schermo del monitor di campata (modulo D).
// Vincoli di progetto: si legge da 10-15 metri, niente scorrimento, contrasto massimo, nessun
// elemento interattivo (nessuno tocca questi schermi). Le dimensioni usano unità viewport così
// la resa è identica su un 1080p e su un 4K senza configurazione.
import { useBayDisplay } from '@/hooks/useBayDisplay';
import type { BayDisplayState } from '@/domain/read-models';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';

export interface BayDisplayBoardProps {
  /** Numero ("1") o codice ("C1") della campata, come scritto nell'URL del kiosk. */
  readonly bayRef: string;
  readonly token?: string | undefined;
}

/** Sfondo e colore del testo per ogni stato: il colore è il primo segnale a distanza. */
const SCREEN: Record<BayDisplayState, string> = {
  SERVING: 'bg-slate-950 text-white',
  RELEASING: 'bg-emerald-600 text-white',
  FREE: 'bg-emerald-600 text-white',
  OFFLINE: 'bg-amber-500 text-slate-950',
};

export function BayDisplayBoard({ bayRef, token }: BayDisplayBoardProps) {
  const query = useBayDisplay(bayRef, token);
  const data = query.data;

  // Nessun dato e polling fallito: schermo di allarme, mai un codice potenzialmente vecchio.
  const offline = query.isError;
  const state: BayDisplayState = offline ? 'OFFLINE' : (data?.display.state ?? 'FREE');
  const bayLabel = data?.display.bayNumber ?? bayRef;

  return (
    <div
      className={cn(
        'flex h-screen w-screen flex-col items-center justify-between overflow-hidden px-[3vw] py-[3vh] tabular-nums',
        SCREEN[state],
      )}
    >
      <header className="flex w-full items-baseline justify-between text-[2.4vw] font-semibold tracking-[0.2em] uppercase opacity-80">
        <span>Campata {bayLabel}</span>
        <span>
          {data !== undefined && !offline
            ? localTimeHHmm(new Date(data.serverTime), data.timeZone)
            : '--:--'}
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center text-center">
        {query.isPending ? (
          <p className="text-[6vw] font-bold opacity-70">Collegamento…</p>
        ) : offline ? (
          <>
            <p className="text-[9vw] leading-none font-black">MONITOR SCOLLEGATO</p>
            <p className="mt-[2vh] text-[3vw] font-semibold">
              Nessuna risposta dal sistema: rivolgersi all&apos;accettazione
            </p>
          </>
        ) : state === 'SERVING' ? (
          <>
            <p className="text-[2.6vw] font-semibold tracking-[0.3em] uppercase opacity-70">
              In servizio
            </p>
            <p className="font-mono text-[26vw] leading-[0.9] font-black tracking-tight">
              {data?.display.currentCode}
            </p>
            {data?.display.currentPlate !== null && data?.display.currentPlate !== undefined ? (
              <p className="mt-[1vh] font-mono text-[7vw] leading-none font-bold tracking-[0.1em]">
                {data.display.currentPlate}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-[11vw] leading-none font-black">CAMPATA LIBERA</p>
            <p className="mt-[2vh] text-[9vw] leading-none font-black tracking-[0.08em]">
              AVANZARE
            </p>
            {state === 'RELEASING' && data?.display.lastCompletedCode !== null ? (
              <p className="mt-[3vh] text-[2.6vw] font-semibold uppercase opacity-80">
                Accettazione {data?.display.lastCompletedCode} completata
              </p>
            ) : null}
          </>
        )}
      </main>

      <footer className="flex w-full items-baseline justify-between text-[2vw] font-semibold tracking-[0.15em] uppercase opacity-70">
        <span>
          {state === 'SERVING' ? `In servizio · Campata ${bayLabel}` : 'Accettazione officina'}
        </span>
        <span>Autoclub Group</span>
      </footer>
    </div>
  );
}
