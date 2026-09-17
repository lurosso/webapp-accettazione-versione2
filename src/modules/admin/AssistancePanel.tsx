'use client';

// Strumenti di assistenza: cosa è incagliato e come sbloccarlo.
// "Rimetti in coda" è reversibile (la pratica torna in attesa) e resta a un tocco; "Annulla
// pratica" no, quindi chiede il secondo tocco in linea. Le accettazioni occupate sono la stessa
// informazione vista dal lato degli schermi: liberare l'accettazione = rimettere in coda la
// pratica che la tiene occupata.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StuckAppointmentView } from '@/application/admin/AssistanceService';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  ApiError,
  fetchAssistance,
  postAppointmentAction,
  postWorkstationEject,
} from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import { localTimeHHmm } from '@/lib/dates';

export interface AssistancePanelProps {
  readonly timeZone: string;
}

/** Oltre questa soglia una presa in carico è probabilmente dimenticata. */
const STALE_MINUTES = 45;

export function AssistancePanel({ timeZone }: AssistancePanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-assistance'] as const,
    queryFn: fetchAssistance,
    refetchInterval: 10_000,
  });
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [confermaAnnulla, setConfermaAnnulla] = useState<string | null>(null);
  // Scollegare uno sportello butta fuori un collega: secondo tocco, come per l'annullamento.
  const [confermaSgancio, setConfermaSgancio] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const agisci = async (
    pratica: StuckAppointmentView,
    action: 'release' | 'cancel',
  ): Promise<void> => {
    setInCorso(pratica.id);
    setErrore(null);
    setMessaggio(null);
    try {
      await postAppointmentAction(pratica.id, { action, expectedVersion: pratica.version });
      setMessaggio(
        action === 'release'
          ? `Pratica ${pratica.code} rimessa in coda: l'accettazione è libera.`
          : `Pratica ${pratica.code} annullata.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-assistance'] }),
        queryClient.invalidateQueries({ queryKey: queueKeys.all }),
      ]);
    } catch (cause) {
      setErrore(cause instanceof ApiError ? cause.message : 'Operazione non riuscita.');
    } finally {
      setInCorso(null);
      setConfermaAnnulla(null);
    }
  };

  const scollega = async (workstationId: string, sportello: string): Promise<void> => {
    setInCorso(workstationId);
    setErrore(null);
    setMessaggio(null);
    try {
      const esito = await postWorkstationEject(workstationId);
      setMessaggio(
        esito.operatorName === null
          ? `${sportello} era già libero.`
          : `${esito.operatorName} scollegato da ${sportello}: il posto è libero${
              esito.stillInProgressCode === null
                ? '.'
                : `, la pratica ${esito.stillInProgressCode} resta in carico.`
            }`,
      );
      await queryClient.invalidateQueries({ queryKey: ['admin-assistance'] });
    } catch (cause) {
      setErrore(cause instanceof ApiError ? cause.message : 'Sgancio non riuscito.');
    } finally {
      setInCorso(null);
      setConfermaSgancio(null);
    }
  };

  const data = query.data;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Sportelli e assistenza</h2>
        <p className="text-sm text-slate-600">
          I quattro sportelli con l&apos;operatore collegato e la pratica in lavorazione, più le
          prese in carico da sbloccare. Una presa in carico da più di {STALE_MINUTES} minuti è
          probabilmente dimenticata: rimetterla in coda libera lo sportello senza perdere nulla.
        </p>
      </div>

      {messaggio !== null ? (
        <p role="status" className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-800">
          {messaggio}
        </p>
      ) : null}
      {errore !== null ? (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {errore}
        </p>
      ) : null}

      {query.isPending || data === undefined ? (
        <TableSkeleton rows={4} columns={5} label="Caricamento dello stato" />
      ) : (
        <>
          {/* Una scheda per sportello fisico, con le due informazioni che l'amministratore cerca
              quando guarda l'officina da lontano: CHI c'è e COSA sta facendo. Sono cose diverse —
              uno sportello può avere un accettatore collegato e nessuna pratica (aspetta il
              prossimo cliente) oppure una pratica ferma e nessuno collegato (sessione scaduta). */}
          <ul className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.bays.map((bay) => (
              <li
                key={bay.bayId}
                data-testid={`sportello-${bay.code}`}
                className={`flex flex-col gap-2 rounded-lg border p-3 ${
                  bay.occupiedBy === null
                    ? 'border-slate-200 bg-slate-50'
                    : 'border-status-in-progress bg-status-in-progress-soft'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-base font-bold text-slate-900">{bay.name}</p>
                  {bay.deskCode !== null ? <Badge tone="neutral">{bay.deskCode}</Badge> : null}
                </div>

                <div>
                  <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Operatore
                  </p>
                  <p className="text-sm font-semibold text-slate-800">
                    {bay.assignedOperatorName ?? (
                      <span className="font-normal text-slate-500">nessuno collegato</span>
                    )}
                    {bay.assignedSince !== null ? (
                      <span className="font-normal text-slate-500">
                        {' '}
                        · dalle {localTimeHHmm(new Date(bay.assignedSince), timeZone)}
                      </span>
                    ) : null}
                  </p>
                  {/* Fine turno e logout dimenticato: il posto resta occupato e il collega del
                      turno dopo non può sedersi. Due tocchi, perché butta fuori una persona. */}
                  {bay.assignedOperatorName !== null && bay.workstationId !== null ? (
                    <Button
                      size="touch"
                      variant={confermaSgancio === bay.workstationId ? 'destructive' : 'ghost'}
                      className="mt-1 px-2"
                      disabled={inCorso === bay.workstationId}
                      data-testid={`scollega-${bay.code}`}
                      onClick={() => {
                        if (confermaSgancio !== bay.workstationId) {
                          setConfermaSgancio(bay.workstationId);
                          return;
                        }
                        void scollega(bay.workstationId!, bay.name);
                      }}
                    >
                      {inCorso === bay.workstationId
                        ? 'Scollego…'
                        : confermaSgancio === bay.workstationId
                          ? 'Confermi? Dovrà rientrare'
                          : 'Scollega'}
                    </Button>
                  ) : null}
                </div>

                <div>
                  <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    In questo momento
                  </p>
                  {bay.occupiedBy === null ? (
                    <p className="text-sm font-semibold text-slate-700">
                      {bay.assignedOperatorName === null
                        ? 'Sportello libero'
                        : 'Libero · in attesa del prossimo cliente'}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-900">
                        In lavorazione: <span className="font-mono">{bay.occupiedBy.plate}</span> ·
                        pratica <span className="font-mono">{bay.occupiedBy.code}</span>
                      </p>
                      <p className="text-xs text-slate-600">
                        {bay.occupiedBy.operatorName ?? 'operatore n/d'} · da{' '}
                        {bay.occupiedBy.minutesInProgress} min
                      </p>
                    </>
                  )}
                </div>

                {bay.occupiedBy !== null ? (
                  <Button
                    size="touch"
                    variant="outline"
                    className="w-full"
                    disabled={inCorso === bay.occupiedBy.id}
                    onClick={() => void agisci(bay.occupiedBy!, 'release')}
                  >
                    Libera sportello
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {data.inProgress.length === 0 ? (
            <EmptyState
              title="Nessuna pratica in carico"
              description="Niente da sbloccare: tutte le accettazioni sono libere."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {data.inProgress.map((p) => {
                const stantia = p.minutesInProgress >= STALE_MINUTES;
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="font-mono text-lg font-bold">{p.code}</span>
                    <span className="font-mono">{p.plate}</span>
                    <span className="text-slate-700">{p.customerName}</span>
                    <span className="text-sm text-slate-500">
                      {p.operatorName ?? 'operatore n/d'}
                      {p.bayCode !== null ? ` · ${p.bayCode}` : ' · senza accettazione'}
                      {p.since !== null
                        ? ` · dalle ${localTimeHHmm(new Date(p.since), timeZone)}`
                        : ''}
                    </span>
                    <Badge tone={stantia ? 'warning' : 'neutral'}>{p.minutesInProgress} min</Badge>
                    <div className="ml-auto flex flex-wrap gap-2">
                      <Button
                        size="touch"
                        variant="outline"
                        disabled={inCorso === p.id}
                        onClick={() => void agisci(p, 'release')}
                      >
                        Rimetti in coda
                      </Button>
                      <Button
                        size="touch"
                        variant="destructive"
                        disabled={inCorso === p.id}
                        onClick={() =>
                          confermaAnnulla === p.id
                            ? void agisci(p, 'cancel')
                            : setConfermaAnnulla(p.id)
                        }
                      >
                        {confermaAnnulla === p.id ? 'Confermi annullamento?' : 'Annulla pratica'}
                      </Button>
                      {confermaAnnulla === p.id ? (
                        <Button
                          size="touch"
                          variant="ghost"
                          onClick={() => setConfermaAnnulla(null)}
                        >
                          No
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
