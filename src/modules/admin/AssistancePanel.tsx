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
import { ApiError, fetchAssistance, postAppointmentAction } from '@/lib/api-client/client';
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

  const data = query.data;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Assistenza</h2>
        <p className="text-sm text-slate-600">
          Accettazioni occupate e pratiche in carico. Una presa in carico da più di {STALE_MINUTES}{' '}
          minuti è probabilmente dimenticata: rimetterla in coda libera l&apos;accettazione senza
          perdere nulla.
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
          <ul className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.bays.map((bay) => (
              <li
                key={bay.bayId}
                className={`rounded-lg border p-3 ${
                  bay.occupiedBy === null
                    ? 'border-slate-200 bg-slate-50'
                    : 'border-status-in-progress bg-status-in-progress-soft'
                }`}
              >
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {bay.name}
                </p>
                {bay.occupiedBy === null ? (
                  <p className="mt-1 text-sm font-semibold text-slate-700">Libera</p>
                ) : (
                  <>
                    <p className="mt-1 font-mono text-lg font-bold">{bay.occupiedBy.code}</p>
                    <p className="text-xs text-slate-600">
                      {bay.occupiedBy.operatorName ?? 'operatore n/d'} ·{' '}
                      {bay.occupiedBy.minutesInProgress} min
                    </p>
                    <Button
                      size="touch"
                      variant="outline"
                      className="mt-2 w-full"
                      disabled={inCorso === bay.occupiedBy.id}
                      onClick={() => void agisci(bay.occupiedBy!, 'release')}
                    >
                      Libera accettazione
                    </Button>
                  </>
                )}
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
