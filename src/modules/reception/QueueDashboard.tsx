'use client';

// Dashboard della coda (client): polling ogni 3 s, filtro sportello / vista globale (nell'URL, così
// il link è condivisibile fra postazioni), banner sync, tabella con azioni rapide e gestione dei
// conflitti fra postazioni (409) e delle campate occupate.
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@/application/auth/IAuthService';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { STALE_WARNING_MS } from '@/config/constants';
import { useAppointmentActions } from '@/hooks/useAppointmentActions';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import { useIsTouchLayout } from '@/hooks/useMediaQuery';
import { useQueue } from '@/hooks/useQueue';
import { checkInPath } from '@/lib/navigation';
import { ApiError, postSync } from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import { formatDateTimeIt } from '@/lib/dates';
import { AppointmentDetailPanel } from './AppointmentDetailPanel';
import { deskOf, QueueTable } from './QueueTable';
import { StatusBadge } from './StatusBadge';
import { SyncBanner } from './SyncBanner';
import type { AppointmentAction, QueueParams, QueueView } from './types';

export interface QueueDashboardProps {
  readonly session: Session;
  readonly homeDeskId: string | null;
  readonly initialView: QueueView;
  readonly initialDeskId: string | null;
}

/** Data della giornata in formato italiano lungo. */
function formatBusinessDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((v) => Number.parseInt(v, 10));
  if (y === undefined || m === undefined || d === undefined) {
    return iso;
  }
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

export function QueueDashboard({
  session,
  homeDeskId,
  initialView,
  initialDeskId,
}: QueueDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Stato della vista letto dall'URL (fonte di verità), con fallback ai valori iniziali del server.
  const view: QueueView =
    (searchParams.get('view') ?? initialView) === 'global' ? 'global' : 'desk';
  const deskId = searchParams.get('deskId') ?? initialDeskId ?? homeDeskId;

  const params: QueueParams = useMemo(
    () => ({ date: null, deskId: view === 'desk' ? deskId : null, view }),
    [view, deskId],
  );
  const queue = useQueue(params);
  const actions = useAppointmentActions();
  // Flusso responsive: stessa applicazione, comportamento diverso secondo il dispositivo.
  // Al banco la presa in carico apre il pannello di dettaglio e l'operatore resta sulla coda;
  // sul piazzale, tablet in mano, porta direttamente all'ispezione fotografica, che è la cosa
  // che l'accettatore farà comunque appena arrivato alla vettura.
  const touchLayout = useIsTouchLayout();
  // Aggiornamento immediato quando un collega tocca una pratica: il flusso porta il segnale, la
  // coda viene riletta. Il polling di 3 s resta attivo come rete di sicurezza.
  const live = useLiveUpdates({
    url: '/api/v1/events/stream',
    types: ['APPOINTMENT_STATUS_CHANGED', 'APPOINTMENT_CREATED', 'BUSINESS_DAY_CLOSED'],
    invalidate: [queueKeys.all],
  });

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  // Si memorizza l'id, non la riga: così il pannello aperto segue gli aggiornamenti del polling
  // (se un collega prende in carico la pratica, il dettaglio lo mostra senza riaprirlo).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const updateUrl = useCallback(
    (next: { view?: QueueView; deskId?: string | null }): void => {
      const sp = new URLSearchParams(searchParams.toString());
      const nextView = next.view ?? view;
      sp.set('view', nextView);
      const nextDesk = next.deskId === undefined ? deskId : next.deskId;
      if (nextView === 'desk' && nextDesk !== null) {
        sp.set('deskId', nextDesk);
      } else {
        sp.delete('deskId');
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, view, deskId],
  );

  /** Dopo una presa in carico riuscita: ispezione su tablet, pannello di dettaglio su schermo grande. */
  const dopoPresaInCarico = useCallback(
    (appointmentId: string): void => {
      if (touchLayout) {
        router.push(checkInPath(appointmentId));
        return;
      }
      setSelectedId(appointmentId);
    },
    [router, touchLayout],
  );

  const onAction = useCallback(
    (appointmentId: string, action: AppointmentAction, expectedVersion: number): void => {
      actions.run(
        appointmentId,
        { action, expectedVersion },
        action === 'take' ? { onSuccess: () => dopoPresaInCarico(appointmentId) } : undefined,
      );
    },
    [actions, dopoPresaInCarico],
  );

  const onSync = async (): Promise<void> => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const { run } = await postSync();
      setSyncMessage(
        run.status === 'FAILED'
          ? `Sync fallita: ${run.errorMessage ?? 'Infinity non raggiungibile'}.`
          : `Sync ${run.status === 'PARTIAL' ? 'parziale' : 'completata'}: ${run.counters.created} nuove pratiche.`,
      );
    } catch (error) {
      setSyncMessage(
        error instanceof ApiError ? error.message : 'Impossibile avviare la sincronizzazione.',
      );
    } finally {
      setSyncing(false);
      await queryClient.invalidateQueries({ queryKey: queueKeys.all });
    }
  };

  const data = queue.data;
  const lastSync = data?.lastSync ?? null;
  const canSync = session.role !== 'ADVISOR' || lastSync === null || lastSync.status === 'FAILED';
  const isStale = queue.dataUpdatedAt > 0 && now - queue.dataUpdatedAt > STALE_WARNING_MS;
  const desks = data?.desks ?? [];
  const currentDesk = desks.find((d) => d.id === deskId) ?? null;
  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      waiting: rows.filter(
        (r) => r.appointment.status === 'WAITING' || r.appointment.status === 'SKIPPED',
      ).length,
      inProgress: rows.filter((r) => r.appointment.status === 'IN_PROGRESS').length,
      completed: rows.filter((r) => r.appointment.status === 'COMPLETED').length,
    };
  }, [data]);

  const outcome = actions.outcome;
  const selectedRow = data?.rows.find((r) => r.appointment.id === selectedId) ?? null;
  const selectedDesk = selectedRow === null ? null : deskOf(selectedRow, desks);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Coda accettazione</h1>
          <p className="text-sm text-slate-600">
            {data !== undefined ? formatBusinessDate(data.businessDate) : 'Caricamento…'}
            {data !== undefined ? (
              <>
                {' · '}
                {counts.waiting} in coda, {counts.inProgress} in carico, {counts.completed}{' '}
                completate
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'desk' ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-600">Sportello</span>
              <Select
                className="w-auto min-w-56"
                value={deskId ?? ''}
                onChange={(event) => updateUrl({ deskId: event.target.value })}
                aria-label="Sportello visualizzato"
              >
                {desks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} · {d.name}
                    {d.id === homeDeskId ? ' (mio)' : ''}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <Badge tone="info">Vista globale: tutti gli sportelli</Badge>
          )}
          <Button
            variant={view === 'global' ? 'default' : 'outline'}
            onClick={() =>
              updateUrl({ view: view === 'global' ? 'desk' : 'global', deskId: homeDeskId })
            }
            aria-pressed={view === 'global'}
          >
            {view === 'global' ? 'Torna al mio sportello' : 'Vista globale'}
          </Button>
          {isStale ? (
            <Badge tone="warning" title="I dati non vengono aggiornati da più di 15 secondi">
              Dati non aggiornati
            </Badge>
          ) : null}
          <Badge
            tone={live === 'live' ? 'success' : 'neutral'}
            title={
              live === 'live'
                ? 'Collegato al flusso eventi: la coda si aggiorna appena qualcosa cambia'
                : 'Flusso eventi non disponibile: la coda si aggiorna comunque ogni 3 secondi'
            }
          >
            {live === 'live' ? 'In diretta' : 'Aggiornamento periodico'}
          </Badge>
        </div>
      </div>

      {view === 'desk' && currentDesk !== null && currentDesk.id !== homeDeskId ? (
        <Alert
          tone="info"
          title={`Stai visualizzando lo sportello ${currentDesk.code} · ${currentDesk.name}`}
        >
          Puoi prendere in carico le sue pratiche per assorbire il carico di lavoro.
        </Alert>
      ) : null}

      {queue.isError ? (
        <Alert
          tone="error"
          title="Impossibile caricare la coda"
          actions={
            <Button size="sm" variant="outline" onClick={() => void queue.refetch()}>
              Riprova
            </Button>
          }
        >
          {queue.error instanceof Error ? queue.error.message : 'Errore di rete.'} I dati mostrati
          potrebbero non essere aggiornati.
        </Alert>
      ) : null}

      {data !== undefined ? (
        <SyncBanner
          lastSync={lastSync}
          timeZone={data.timeZone}
          canSync={canSync}
          syncing={syncing}
          onSync={() => void onSync()}
          message={syncMessage}
        />
      ) : null}

      {outcome !== null && outcome.kind === 'error' ? (
        <Alert
          tone="error"
          title="Azione non riuscita"
          actions={
            <Button size="sm" variant="outline" onClick={actions.clearOutcome}>
              Chiudi
            </Button>
          }
        >
          {outcome.message}
        </Alert>
      ) : null}

      {data !== undefined ? (
        data.rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <p className="text-lg font-semibold">Nessuna pratica per oggi</p>
            <p className="mt-1 text-sm text-slate-600">
              {lastSync === null
                ? "L'agenda non è ancora stata sincronizzata con Infinity."
                : view === 'desk'
                  ? 'Nessun appuntamento per questo sportello: prova la vista globale.'
                  : 'Nessun appuntamento in agenda.'}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {canSync ? (
                <Button onClick={() => void onSync()} disabled={syncing}>
                  Sincronizza ora
                </Button>
              ) : null}
              {view === 'desk' ? (
                <Button variant="outline" onClick={() => updateUrl({ view: 'global' })}>
                  Vista globale
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <QueueTable
            rows={data.rows}
            brands={data.brands}
            desks={data.desks}
            homeDeskId={homeDeskId}
            showDesk={view === 'global' || currentDesk?.id !== homeDeskId}
            timeZone={data.timeZone}
            serverTime={data.serverTime}
            pendingId={actions.pendingId}
            currentOperatorName={session.displayName}
            onAction={onAction}
            onSelect={(row) => setSelectedId(row.appointment.id)}
          />
        )
      ) : queue.isLoading ? (
        <p className="text-sm text-slate-500">Caricamento della coda…</p>
      ) : null}

      {data !== undefined ? (
        <p className="text-xs text-slate-400">
          Aggiornamento automatico ogni 3 secondi · ultimo dato dal server:{' '}
          {formatDateTimeIt(data.serverTime, data.timeZone)}
        </p>
      ) : null}

      <AppointmentDetailPanel
        row={selectedRow}
        brandName={
          selectedRow === null
            ? ''
            : (data?.brands.find((b) => b.id === selectedRow.appointment.brandId)?.name ?? '')
        }
        deskLabel={selectedDesk === null ? null : `${selectedDesk.code} · ${selectedDesk.name}`}
        timeZone={data?.timeZone ?? 'Europe/Rome'}
        currentOperatorName={session.displayName}
        onClose={() => setSelectedId(null)}
      />

      <Dialog
        open={outcome !== null && outcome.kind === 'version-conflict'}
        title="Pratica modificata da un'altra postazione"
        description={outcome?.kind === 'version-conflict' ? outcome.message : undefined}
        onClose={actions.clearOutcome}
        footer={<Button onClick={actions.clearOutcome}>Aggiorna</Button>}
      >
        {outcome?.kind === 'version-conflict' && outcome.current !== null ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-slate-50 p-3 text-sm">
            <span className="font-mono text-base font-bold">{outcome.current.code}</span>
            <StatusBadge status={outcome.current.status} />
            <span className="text-slate-600">
              {outcome.current.customer.lastName} {outcome.current.customer.firstName} ·{' '}
              {outcome.current.vehicle.plate}
            </span>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={outcome !== null && outcome.kind === 'bay-busy'}
        title="Accettazione occupata"
        description={outcome?.kind === 'bay-busy' ? outcome.message : undefined}
        onClose={actions.clearOutcome}
        footer={
          <Button variant="outline" onClick={actions.clearOutcome}>
            Annulla
          </Button>
        }
      >
        {outcome?.kind === 'bay-busy' ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-600">
              Scegli un&apos;accettazione libera oppure procedi senza assegnarla.
            </p>
            <div className="flex flex-wrap gap-2">
              {outcome.freeBays.map((bay) => (
                <Button
                  key={bay.id}
                  variant="secondary"
                  onClick={() =>
                    actions.run(
                      outcome.appointmentId,
                      {
                        action: 'take',
                        expectedVersion: outcome.expectedVersion,
                        bayId: bay.id,
                      },
                      { onSuccess: () => dopoPresaInCarico(outcome.appointmentId) },
                    )
                  }
                >
                  {bay.code} · {bay.name}
                </Button>
              ))}
              <Button
                variant="ghost"
                onClick={() =>
                  actions.run(
                    outcome.appointmentId,
                    { action: 'take', expectedVersion: outcome.expectedVersion },
                    { onSuccess: () => dopoPresaInCarico(outcome.appointmentId) },
                  )
                }
              >
                Senza accettazione
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
