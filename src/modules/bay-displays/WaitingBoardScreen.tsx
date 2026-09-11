'use client';

// Tabellone della sala d'attesa, impostato come quelli degli uffici pubblici: in alto i codici
// chiamati ora con la campata a cui presentarsi, in basso i prossimi turni.
// Vincoli: si legge da tutta la sala, non si tocca, non scorre. Solo codici: né targhe né nomi,
// perché lo schermo è visibile a chiunque sia presente.
import { useWaitingBoard } from '@/hooks/useWaitingBoard';
import type { BoardServingEntry } from '@/domain/read-models';
import { localTimeHHmm } from '@/lib/dates';

export interface WaitingBoardScreenProps {
  /** Quanti prossimi turni elencare (impostabile da `?prossimi=`). */
  readonly nextCount: number;
}

/** Destinazione da annunciare: la campata è il posto fisico, lo sportello è il ripiego. */
function destinationOf(entry: BoardServingEntry): string {
  if (entry.bayNumber !== null) {
    return `Campata ${entry.bayNumber}`;
  }
  if (entry.deskCode !== null) {
    return `Sportello ${entry.deskCode}`;
  }
  return 'In accettazione';
}

export function WaitingBoardScreen({ nextCount }: WaitingBoardScreenProps) {
  const query = useWaitingBoard(nextCount);
  const data = query.data;
  const offline = query.isError;
  const serving = data?.board.serving ?? [];
  const next = data?.board.next ?? [];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-white tabular-nums">
      <header className="flex items-baseline justify-between border-b border-white/15 px-[2.5vw] py-[1.5vh]">
        <span className="text-[2.2vw] font-bold tracking-[0.2em] uppercase">
          Accettazione officina
        </span>
        <span className="text-[2.2vw] font-semibold opacity-80">
          {data !== undefined && !offline
            ? localTimeHHmm(new Date(data.serverTime), data.timeZone)
            : '--:--'}
        </span>
      </header>

      {offline ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-amber-500 text-center text-slate-950">
          <p className="text-[7vw] leading-none font-black">TABELLONE SCOLLEGATO</p>
          <p className="mt-[2vh] text-[2.5vw] font-semibold">
            Nessuna risposta dal sistema: rivolgersi all&apos;accettazione
          </p>
        </div>
      ) : (
        <>
          <main className="flex flex-1 flex-col px-[2.5vw] py-[2vh]">
            <h1 className="text-[2vw] font-bold tracking-[0.3em] text-emerald-400 uppercase">
              Chiamati ora
            </h1>
            {query.isPending ? (
              <p className="mt-[4vh] text-[4vw] font-bold opacity-60">Collegamento…</p>
            ) : serving.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <p className="text-[5vw] leading-tight font-black opacity-80">
                  Nessun cliente in lavorazione
                </p>
                <p className="mt-[1vh] text-[2.2vw] opacity-60">
                  Attendere la chiamata del proprio codice
                </p>
              </div>
            ) : (
              <ul className="mt-[1.5vh] flex flex-col gap-[1.2vh]">
                {serving.map((entry, index) => (
                  <li
                    key={entry.code}
                    className={`flex items-center justify-between gap-[2vw] rounded-[1vw] px-[2vw] py-[1.2vh] ${
                      // La chiamata più recente è quella che la sala deve notare per prima.
                      index === 0 ? 'bg-emerald-500 text-slate-950' : 'bg-white/10 text-white'
                    }`}
                  >
                    <span className="font-mono text-[9vw] leading-none font-black tracking-tight">
                      {entry.code}
                    </span>
                    <span className="flex items-center gap-[1.5vw] text-right">
                      <span aria-hidden="true" className="text-[5vw] leading-none font-black">
                        →
                      </span>
                      <span className="text-[4.5vw] leading-none font-black uppercase">
                        {destinationOf(entry)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </main>

          <footer className="border-t border-white/15 bg-black/40 px-[2.5vw] py-[2vh]">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[1.8vw] font-bold tracking-[0.3em] text-amber-300 uppercase">
                Prossimi turni
              </h2>
              {data !== undefined ? (
                <span className="text-[1.6vw] font-semibold opacity-70">
                  {data.board.waitingCount === 0
                    ? 'Nessuna pratica in coda'
                    : data.board.waitingCount === 1
                      ? '1 cliente in coda'
                      : `${data.board.waitingCount} clienti in coda`}
                </span>
              ) : null}
            </div>
            {next.length === 0 ? (
              <p className="mt-[1vh] text-[2.6vw] font-semibold opacity-60">
                Nessun codice in attesa
              </p>
            ) : (
              <ul className="mt-[1vh] flex flex-wrap items-center gap-[1.5vw]">
                {next.map((entry) => (
                  <li
                    key={entry.code}
                    className="rounded-[0.6vw] bg-white/10 px-[1.5vw] py-[0.6vh] font-mono text-[4.5vw] leading-none font-bold"
                  >
                    {entry.code}
                  </li>
                ))}
              </ul>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
