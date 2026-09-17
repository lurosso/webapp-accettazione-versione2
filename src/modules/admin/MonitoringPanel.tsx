'use client';

// Monitoraggio operativo: i quattro sportelli e le pratiche da sbloccare, in un blocco solo.
//
// Prima erano due riquadri diversi che mostravano la stessa griglia A-B-C-D — uno per scegliere
// cosa guardare, uno per sbloccare — e l'amministratore leggeva due volte le stesse informazioni
// per fare due cose diverse. Qui ogni sportello è una scheda sola, con quello che c'è da sapere
// (chi è collegato, cosa sta lavorando) e quello che c'è da fare (guardarne la coda, scollegare
// chi ha finito il turno, liberare il posto da una pratica ferma).
//
// Sotto, le pratiche in carico da troppo tempo: sono la stessa informazione vista dal lato delle
// pratiche invece che da quello dei banchi, ed è lì che si interviene quando qualcosa si incaglia.
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StuckAppointmentView } from '@/application/admin/AssistanceService';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  ApiError,
  fetchAssistance,
  postAppointmentAction,
  postWorkstationEject,
} from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';

export interface MonitoringPanelProps {
  readonly timeZone: string;
}

/** Oltre questa soglia una presa in carico è probabilmente dimenticata. */
const STALE_MINUTES = 45;

/** Coda di uno sportello, filtrata sulla sua area per marchio e marcata come monitoraggio. */
function monitorHref(deskId: string | null, etichetta: string): string {
  const params = new URLSearchParams({ view: 'desk', monitor: etichetta });
  if (deskId !== null) {
    params.set('deskId', deskId);
  }
  return `/accettazione?${params.toString()}`;
}

export function MonitoringPanel({ timeZone }: MonitoringPanelProps) {
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
          ? `Pratica ${pratica.code} rimessa in coda: lo sportello è libero.`
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
    <Panel>
      <PanelHeader
        title="Monitoraggio operativo"
        description="Cosa sta succedendo ai banchi: da qui si guarda la coda di uno sportello, si scollega chi ha finito il turno e si sbloccano le pratiche rimaste ferme. Gli account delle persone stanno nella scheda «Persone e postazioni»."
        actions={
          <Link
            href="/accettazione?view=global&sola-lettura=1&monitor=Coda%20globale"
            data-testid="monitora-globale"
            className="bg-brand-secondary hover:bg-brand-blue-dark premibile focus-anello min-h-touch inline-flex items-center rounded-md px-5 text-sm font-semibold text-white"
          >
            Coda globale (sola lettura)
          </Link>
        }
      />

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
        <TableSkeleton rows={4} columns={4} label="Caricamento degli sportelli" />
      ) : (
        <>
          {/* Una scheda per sportello: CHI c'è, COSA sta facendo, cosa si può fare. Sono cose
              diverse — un banco può avere un accettatore collegato e nessuna pratica (aspetta il
              prossimo cliente) oppure una pratica ferma e nessuno collegato (sessione scaduta). */}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.bays.map((bay) => (
              <li
                key={bay.bayId}
                data-testid={`sportello-${bay.code}`}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-3',
                  bay.occupiedBy === null
                    ? 'border-slate-200 bg-slate-50'
                    : 'border-status-in-progress bg-status-in-progress-soft',
                )}
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

                {/* Azioni della scheda, dalla più innocua alla più invadente. */}
                <div className="mt-auto flex flex-col gap-2">
                  <Link
                    href={monitorHref(
                      bay.deskId,
                      `${bay.name}${bay.deskCode === null ? '' : ` · ${bay.deskCode}`}`,
                    )}
                    data-testid={`monitora-${bay.code}`}
                    className="focus-visible:ring-brand-blue-light inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Monitora la coda
                  </Link>
                  {bay.assignedOperatorName !== null && bay.workstationId !== null ? (
                    // Fine turno e logout dimenticato: il posto resta occupato e il collega del
                    // turno dopo non può sedersi. Due tocchi, perché butta fuori una persona.
                    <Button
                      size="touch"
                      variant={confermaSgancio === bay.workstationId ? 'destructive' : 'ghost'}
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
                          : 'Scollega operatore'}
                    </Button>
                  ) : null}
                  {bay.occupiedBy !== null ? (
                    <Button
                      size="touch"
                      variant="outline"
                      disabled={inCorso === bay.occupiedBy.id}
                      onClick={() => void agisci(bay.occupiedBy!, 'release')}
                    >
                      Libera sportello
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6">
            <h3 className="text-base font-semibold text-slate-900">Pratiche in carico</h3>
            <p className="mb-3 text-sm text-slate-600">
              Una presa in carico da più di {STALE_MINUTES} minuti è probabilmente dimenticata:
              rimetterla in coda libera lo sportello senza perdere nulla.
            </p>
            {data.inProgress.length === 0 ? (
              <EmptyState
                title="Nessuna pratica in carico"
                description="Niente da sbloccare: tutti gli sportelli sono liberi."
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
                        {p.bayCode !== null ? ` · sportello ${p.bayCode}` : ' · senza sportello'}
                        {p.since !== null
                          ? ` · dalle ${localTimeHHmm(new Date(p.since), timeZone)}`
                          : ''}
                      </span>
                      <Badge tone={stantia ? 'warning' : 'neutral'}>
                        {p.minutesInProgress} min
                      </Badge>
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
          </div>
        </>
      )}
    </Panel>
  );
}
