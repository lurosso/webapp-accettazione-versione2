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
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { STALE_WARNING_MS } from '@/config/constants';
import { useAppointmentActions } from '@/hooks/useAppointmentActions';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import { useIsTouchLayout } from '@/hooks/useMediaQuery';
import { useQueue } from '@/hooks/useQueue';
import { canAccess, checkInPath } from '@/lib/navigation';
import { ApiError, postSync } from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import { formatDateTimeIt } from '@/lib/dates';
import { AppointmentDetailPanel } from './AppointmentDetailPanel';
import { NewWalkInDialog } from './NewWalkInDialog';
import { deskOf, QueueTable } from './QueueTable';
import { ReturnsTable } from './ReturnsTable';
import { StatusBadge } from './StatusBadge';
import { SyncBanner } from './SyncBanner';
import type { AppointmentAction, QueueParams, QueueView } from './types';

export interface QueueDashboardProps {
  readonly session: Session;
  readonly homeDeskId: string | null;
  readonly initialView: QueueView;
  readonly initialDeskId: string | null;
  /**
   * Pulsante «Nuovo cliente (senza appuntamento)». L'inserimento avviene a monte in Infinity dal BDC,
   * quindi di norma agli accettatori non si mostra (UI_MANUAL_INTAKE); l'API e il dialogo restano.
   */
  readonly manualIntakeEnabled: boolean;
  /**
   * Collegamenti di servizio per lo sviluppo (`DEV_QUICK_LOGIN`): nel dettaglio di una pratica
   * compare il link alla pagina di tracciamento del cliente, per provarla senza simulare un
   * messaggio WhatsApp. In produzione è sempre spento.
   */
  readonly debugCustomerLink?: boolean;
  /**
   * Monitoraggio in sola lettura (amministratore): la coda si guarda ma non si tocca. Serve a
   * controllare come sta andando l'officina senza il rischio di prendere in carico la pratica di
   * un collega mentre si scorre l'elenco.
   */
  readonly readOnly?: boolean;
  /** Che cosa si sta monitorando ("Sportello A · FCA"), mostrato nella fascia di sola lettura. */
  readonly monitorLabel?: string | null;
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
  manualIntakeEnabled,
  debugCustomerLink = false,
  readOnly = false,
  monitorLabel = null,
}: QueueDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Stato della vista letto dall'URL (fonte di verità), con fallback ai valori iniziali del server.
  const richiesta = searchParams.get('view') ?? initialView;
  const view: QueueView =
    richiesta === 'global' ? 'global' : richiesta === 'returns' ? 'returns' : 'desk';
  const deskId = searchParams.get('deskId') ?? initialDeskId ?? homeDeskId;

  const params: QueueParams = useMemo(
    () => ({ date: null, deskId: view === 'desk' ? deskId : null, view }),
    [view, deskId],
  );
  const queue = useQueue(params);
  const actions = useAppointmentActions();
  // Separazione PC / tablet: stessa applicazione, comportamento diverso secondo il dispositivo.
  // Al banco la presa in carico apre il pannello di dettaglio e l'operatore resta sulla coda,
  // senza alcun passaggio alle foto (da un PC non si scattano); sul piazzale, tablet in mano,
  // porta direttamente all'ispezione fotografica e il dettaglio si apre come finestra centrale.
  const touchLayout = useIsTouchLayout();
  // Aggiornamento immediato quando un collega tocca una pratica, e anche quando è il CLIENTE a
  // muovere qualcosa: «sono arrivato» e «sto arrivando in ritardo» cambiano la riga in coda, e
  // l'accettatore non deve ricaricare la pagina per accorgersene. Il polling di 3 s resta attivo
  // come rete di sicurezza.
  const live = useLiveUpdates({
    url: '/api/v1/events/stream',
    types: [
      'APPOINTMENT_STATUS_CHANGED',
      'APPOINTMENT_CREATED',
      'CUSTOMER_ARRIVED',
      'CUSTOMER_LATE_NOTICE',
      'BUSINESS_DAY_CLOSED',
    ],
    invalidate: [queueKeys.all],
  });

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  // Si memorizza l'id, non la riga: così il pannello aperto segue gli aggiornamenti del polling
  // (se un collega prende in carico la pratica, il dettaglio lo mostra senza riaprirlo).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Inserimento manuale: il cliente senza appuntamento entra in coda da qui.
  const [nuovoCliente, setNuovoCliente] = useState(false);
  const [messaggioCoda, setMessaggioCoda] = useState<string | null>(null);
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
        // Anche la riapertura rimette la pratica in carico: stesso seguito della presa in carico.
        action === 'take' || action === 'reopen-completed'
          ? { onSuccess: () => dopoPresaInCarico(appointmentId) }
          : undefined,
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
      {/* Intestazione e comandi: su un tablet piccolo i comandi prendono tutta la riga sotto al
          titolo, con spazi larghi fra loro; da 1024 px in su tornano accanto al titolo. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {view === 'returns' ? 'Riconsegne veicoli' : 'Coda accettazione'}
          </h1>
          <p className="text-sm text-slate-600">
            {data !== undefined ? formatBusinessDate(data.businessDate) : 'Caricamento…'}
            {data !== undefined ? (
              <>
                {' · '}
                {view === 'returns'
                  ? `${counts.waiting} da riconsegnare, ${counts.completed} riconsegnate`
                  : `${counts.waiting} in coda, ${counts.inProgress} in carico, ${counts.completed} completate`}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
          {view === 'desk' ? (
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm lg:flex-none">
              <span className="text-slate-600">Sportello</span>
              <Select
                className="w-full min-w-0 lg:w-auto lg:min-w-56"
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
          ) : view === 'global' ? (
            <Badge tone="info">Vista globale: tutti gli sportelli</Badge>
          ) : (
            <Badge tone="info">Riconsegne di oggi: commesse in consegna, fuori dalla coda</Badge>
          )}
          {manualIntakeEnabled && !readOnly ? (
            <Button variant="outline" size="touch" onClick={() => setNuovoCliente(true)}>
              Nuovo cliente (senza appuntamento)
            </Button>
          ) : null}
          <Button
            variant={view === 'global' ? 'default' : 'outline'}
            size="touch"
            onClick={() =>
              updateUrl({ view: view === 'global' ? 'desk' : 'global', deskId: homeDeskId })
            }
            aria-pressed={view === 'global'}
          >
            {view === 'global' ? 'Torna al mio sportello' : 'Vista globale'}
          </Button>
          <Button
            variant={view === 'returns' ? 'default' : 'outline'}
            size="touch"
            onClick={() =>
              updateUrl({ view: view === 'returns' ? 'desk' : 'returns', deskId: homeDeskId })
            }
            aria-pressed={view === 'returns'}
            data-testid="scheda-riconsegne"
          >
            {view === 'returns'
              ? 'Torna alla coda'
              : `Riconsegne${data !== undefined ? ` (${data.returnsCount})` : ''}`}
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

      {readOnly ? (
        <Alert
          tone="info"
          title={`Monitoraggio in sola lettura${monitorLabel === null ? '' : `: ${monitorLabel}`}`}
        >
          Stai guardando la coda come amministratore: le azioni sulle pratiche sono disattivate, per
          non toccare per sbaglio il lavoro di chi è al banco. Per intervenire davvero usa gli
          strumenti di assistenza in Amministrazione.
        </Alert>
      ) : null}

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
            <Button size="touch" variant="outline" onClick={() => void queue.refetch()}>
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

      {messaggioCoda !== null ? (
        <Alert
          tone="info"
          title={messaggioCoda}
          actions={
            <Button size="touch" variant="outline" onClick={() => setMessaggioCoda(null)}>
              Chiudi
            </Button>
          }
        >
          La pratica è in coda con il prossimo codice; il cliente riceve la conferma se ha lasciato
          un telefono.
        </Alert>
      ) : null}

      {outcome !== null && outcome.kind === 'error' ? (
        <Alert
          tone="error"
          title="Azione non riuscita"
          actions={
            <Button size="touch" variant="outline" onClick={actions.clearOutcome}>
              Chiudi
            </Button>
          }
        >
          {outcome.message}
        </Alert>
      ) : null}

      {data !== undefined && view === 'returns' ? (
        data.rows.length === 0 ? (
          <EmptyState
            size="page"
            title="Nessuna riconsegna prevista oggi"
            description="Le commesse in consegna arrivano dal planning di Infinity con la sincronizzazione."
          />
        ) : (
          <ReturnsTable
            rows={data.rows}
            brands={data.brands}
            timeZone={data.timeZone}
            serverTime={data.serverTime}
          />
        )
      ) : data !== undefined ? (
        data.rows.length === 0 ? (
          <EmptyState
            size="page"
            title="Nessuna pratica per oggi"
            description={
              lastSync === null
                ? "L'agenda non è ancora stata sincronizzata con Infinity."
                : view === 'desk'
                  ? 'Nessun appuntamento per questo sportello: prova la vista globale.'
                  : 'Nessun appuntamento in agenda.'
            }
            actions={
              <>
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
              </>
            }
          />
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
            selectedId={selectedId}
            readOnly={readOnly}
            // Stessa riga toccata due volte: il pannello si chiude. Sul tablet è il gesto naturale.
            onSelect={(row) =>
              setSelectedId((corrente) =>
                corrente === row.appointment.id ? null : row.appointment.id,
              )
            }
          />
        )
      ) : queue.isLoading ? (
        <TableSkeleton rows={6} columns={8} label="Caricamento della coda" />
      ) : null}

      {data !== undefined ? (
        <p className="text-xs text-slate-400">
          Aggiornamento automatico ogni 3 secondi · ultimo dato dal server:{' '}
          {formatDateTimeIt(data.serverTime, data.timeZone)}
        </p>
      ) : null}

      <AppointmentDetailPanel
        row={selectedRow}
        presentation={touchLayout ? 'modal' : 'side'}
        allowCheckIn={touchLayout}
        brandName={
          selectedRow === null
            ? ''
            : (data?.brands.find((b) => b.id === selectedRow.appointment.brandId)?.name ?? '')
        }
        deskLabel={selectedDesk === null ? null : `${selectedDesk.code} · ${selectedDesk.name}`}
        timeZone={data?.timeZone ?? 'Europe/Rome'}
        currentOperatorName={session.displayName}
        debugCustomerLink={debugCustomerLink}
        onClose={() => setSelectedId(null)}
        actionPending={selectedRow !== null && actions.pendingId === selectedRow.appointment.id}
        canConfirmAutoClose={canAccess('manager', session.role)}
        // In sola lettura il pannello resta consultabile ma senza comandi: si guarda, non si agisce.
        onAction={
          readOnly
            ? undefined
            : (action) => {
                if (selectedRow !== null) {
                  onAction(selectedRow.appointment.id, action, selectedRow.appointment.version);
                }
              }
        }
      />

      {nuovoCliente && data !== undefined ? (
        <NewWalkInDialog
          open={nuovoCliente}
          brands={data.brands}
          defaultBrandId={
            desks.find((d) => d.id === homeDeskId)?.brandIds[0] ?? data.brands[0]?.id ?? null
          }
          deskId={homeDeskId}
          onClose={() => setNuovoCliente(false)}
          onCreated={(appointment) => {
            setNuovoCliente(false);
            setMessaggioCoda(
              `${appointment.customer.lastName} ${appointment.customer.firstName} (${appointment.vehicle.plate}) è in coda con il codice ${appointment.code}.`,
            );
            void queryClient.invalidateQueries({ queryKey: queueKeys.all });
            if (!touchLayout) {
              setSelectedId(appointment.id);
            }
          }}
        />
      ) : null}

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
