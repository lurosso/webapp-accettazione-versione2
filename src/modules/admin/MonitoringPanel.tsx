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
//
// Le due azioni che toccano il lavoro di qualcun altro — scollegare una persona, annullare una
// pratica — passano dal `HoldButton`: prima avevano ciascuna la propria conferma in due tocchi
// scritta a mano, con la propria idea di quando decade.
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StuckAppointmentView } from '@/application/admin/AssistanceService';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Button } from '@/components/ui/button';
import { HoldButton } from '@/components/ui/hold-button';
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
function monitorHref(deskId: string | null, etichetta: string, bayId: string | null): string {
  const params = new URLSearchParams({ view: 'desk', monitor: etichetta });
  if (deskId !== null) {
    params.set('deskId', deskId);
  }
  // Anche lo sportello, non solo la sua area: chi ha cliccato «Monitora» sulla scheda di B vuole
  // trovarsi su B, non sul primo banco dell'area. La coda mostrata è la stessa — è dell'area — ma
  // il selettore e il sottotitolo devono dire il banco che si è scelto.
  if (bayId !== null) {
    params.set('bayId', bayId);
  }
  return `/accettazione?${params.toString()}`;
}

/** Collegamento che si punta col dito: alto quanto un comando, non quanto una riga di testo. */
const LINK_COMANDO =
  'controllo transizione focus-anello premibile inline-flex items-center justify-center rounded-md px-4 testo-corpo font-semibold';

export function MonitoringPanel({ timeZone }: MonitoringPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-assistance'] as const,
    queryFn: fetchAssistance,
    refetchInterval: 10_000,
  });
  const [inCorso, setInCorso] = useState<string | null>(null);
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
            className={cn(LINK_COMANDO, 'bg-brand-secondary hover:bg-brand-blue-dark text-white')}
          >
            Coda globale (sola lettura)
          </Link>
        }
      />

      {messaggio !== null ? (
        <Notice tone="info" className="mb-3">
          {messaggio}
        </Notice>
      ) : null}
      {errore !== null ? (
        <Notice tone="error" className="mb-3">
          {errore}
        </Notice>
      ) : null}

      {query.isPending || data === undefined ? (
        <TableSkeleton rows={4} columns={4} label="Caricamento degli sportelli" />
      ) : (
        <>
          {/* Una scheda per sportello: CHI c'è, COSA sta facendo, cosa si può fare. Sono cose
              diverse — un banco può avere un accettatore collegato e nessuna pratica (aspetta il
              prossimo cliente) oppure una pratica ferma e nessuno collegato (sessione scaduta). */}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.bays.map((bay) => {
              const occupata = bay.occupiedBy;
              const workstationId = bay.workstationId;
              return (
                <li
                  key={bay.bayId}
                  data-testid={`sportello-${bay.code}`}
                  className={cn(
                    'flex flex-col gap-3 rounded-lg border p-3',
                    occupata === null
                      ? 'border-line bg-surface-sunken'
                      : 'border-status-in-progress bg-status-in-progress-soft',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="testo-dato font-bold">{bay.name}</p>
                    {bay.deskCode !== null ? <Badge tone="neutral">{bay.deskCode}</Badge> : null}
                  </div>

                  <div>
                    <p className="text-ink-muted text-[11px] font-semibold tracking-wide uppercase">
                      Operatore
                    </p>
                    <p className="text-ink-soft testo-corpo font-semibold">
                      {bay.assignedOperatorName ?? (
                        <span className="text-ink-muted font-normal">nessuno collegato</span>
                      )}
                      {bay.assignedSince !== null ? (
                        <span className="text-ink-muted font-normal">
                          {' '}
                          · dalle {localTimeHHmm(new Date(bay.assignedSince), timeZone)}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div>
                    <p className="text-ink-muted text-[11px] font-semibold tracking-wide uppercase">
                      In questo momento
                    </p>
                    {occupata === null ? (
                      <p className="text-ink-soft testo-corpo font-semibold">
                        {bay.assignedOperatorName === null
                          ? 'Sportello libero'
                          : 'Libero · in attesa del prossimo cliente'}
                      </p>
                    ) : (
                      <>
                        <p className="testo-corpo font-semibold">
                          In lavorazione: <span className="font-mono">{occupata.plate}</span> ·
                          pratica <span className="font-mono">{occupata.code}</span>
                        </p>
                        <p className="text-ink-muted testo-nota">
                          {occupata.operatorName ?? 'operatore n/d'} · da{' '}
                          {occupata.minutesInProgress} min
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
                        bay.bayId,
                      )}
                      data-testid={`monitora-${bay.code}`}
                      className={cn(
                        LINK_COMANDO,
                        'border-line bg-surface text-ink-soft hover:bg-surface-sunken border',
                      )}
                    >
                      Monitora la coda
                    </Link>
                    {bay.assignedOperatorName !== null && workstationId !== null ? (
                      // Fine turno e logout dimenticato: il posto resta occupato e il collega del
                      // turno dopo non può sedersi. Chiede conferma, perché butta fuori una persona.
                      <HoldButton
                        variant="ghost"
                        disabled={inCorso === workstationId}
                        data-testid={`scollega-${bay.code}`}
                        confirmLabel="Confermi? Dovrà rientrare"
                        actionLabel={`Scollega ${bay.assignedOperatorName} da ${bay.name}`}
                        onConfirm={() => void scollega(workstationId, bay.name)}
                      >
                        {inCorso === workstationId ? 'Scollego…' : 'Scollega operatore'}
                      </HoldButton>
                    ) : null}
                    {occupata !== null ? (
                      <Button
                        variant="outline"
                        disabled={inCorso === occupata.id}
                        onClick={() => void agisci(occupata, 'release')}
                      >
                        Libera sportello
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-6">
            <h3 className="testo-dato font-semibold">Pratiche in carico</h3>
            <p className="text-ink-soft testo-corpo mb-3">
              Una presa in carico da più di {STALE_MINUTES} minuti è probabilmente dimenticata:
              rimetterla in coda libera lo sportello senza perdere nulla.
            </p>
            {data.inProgress.length === 0 ? (
              <EmptyState
                title="Nessuna pratica in carico"
                description="Niente da sbloccare: tutti gli sportelli sono liberi."
              />
            ) : (
              <ul className="divide-line-subtle flex flex-col divide-y">
                {data.inProgress.map((p) => {
                  const stantia = p.minutesInProgress >= STALE_MINUTES;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="testo-codice font-mono font-bold">{p.code}</span>
                      <span className="testo-dato font-mono">{p.plate}</span>
                      <span className="text-ink-soft">{p.customerName}</span>
                      <span className="text-ink-muted testo-nota">
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
                          size="sm"
                          variant="outline"
                          disabled={inCorso === p.id}
                          onClick={() => void agisci(p, 'release')}
                        >
                          Rimetti in coda
                        </Button>
                        {/* Annullare è l'unica azione qui che il cliente si vede arrivare
                            addosso: rosso solo quando chiede conferma, altrimenti in ogni riga
                            dell'elenco ci sarebbe un pulsante pieno di rosso che non ferma più. */}
                        <HoldButton
                          size="sm"
                          variant="destructiveQuiet"
                          disabled={inCorso === p.id}
                          confirmLabel="Confermi annullamento?"
                          actionLabel={`Annulla la pratica ${p.code} di ${p.customerName}`}
                          onConfirm={() => void agisci(p, 'cancel')}
                        >
                          Annulla pratica
                        </HoldButton>
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
