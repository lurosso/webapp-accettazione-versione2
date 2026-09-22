'use client';

// Dashboard della coda (client): polling ogni 3 s, filtro sportello / vista globale (nell'URL, così
// il link è condivisibile fra postazioni), banner sync, tabella con azioni rapide e gestione dei
// conflitti fra postazioni (409) e delle campate occupate.
import { isLate } from '@/domain/entities/appointment';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@/application/auth/IAuthService';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TableSkeleton } from '@/components/ui/skeleton';
import { UndoToast } from '@/components/ui/undo-toast';
import { EmptyState } from '@/components/shared/EmptyState';
import { STALE_WARNING_MS } from '@/config/constants';
import { useAppointmentActions } from '@/hooks/useAppointmentActions';
import { useTransitionRouter } from '@/hooks/useTransitionRouter';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import { useIsTouchLayout } from '@/hooks/useMediaQuery';
import { useQueue } from '@/hooks/useQueue';
import { canAccess, checkInPath } from '@/lib/navigation';
import { ApiError, patchAppointmentRetention, postSync } from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import { formatDateTimeIt } from '@/lib/dates';
import { AppointmentDetailPanel } from './AppointmentDetailPanel';
import { NewWalkInDialog } from './NewWalkInDialog';
import { QueueTable } from './QueueTable';
import { sportelloLabel } from './desk-labels';
import { ReturnsTable } from './ReturnsTable';
import { StatusBadge } from './StatusBadge';
import { SyncBanner } from './SyncBanner';
import type { AppointmentAction, QueueParams, QueueView } from './types';

/**
 * L'azione contraria di quelle che si disfano. Esistono già nella macchina a stati — una pratica
 * presa in carico si rimette in coda, una saltata si ripristina — quindi «Annulla» non è un
 * percorso speciale: è un comando normale mandato al posto dell'operatore.
 */
const AZIONE_CONTRARIA: Partial<Record<AppointmentAction, AppointmentAction>> = {
  take: 'release',
  skip: 'restore',
};

/** Come si chiama, in officina, quello che è appena successo. */
const ESITO_ANNULLABILE: Partial<Record<AppointmentAction, string>> = {
  take: 'presa in carico',
  skip: 'saltata',
};

/** Quello che serve per tornare indietro: la pratica, la sua versione nuova, il comando inverso. */
interface Annullabile {
  readonly messaggio: string;
  readonly appointmentId: string;
  readonly version: number;
  readonly contraria: AppointmentAction;
}

import { LATE_GRACE_MINUTES } from '@/config/constants';
import { QueueHeader } from './QueueHeader';

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
  const transizione = useTransitionRouter();
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
  const [annullabile, setAnnullabile] = useState<Annullabile | null>(null);
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
      'NOTIFICATION_JOB_CHANGED',
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
    (next: { view?: QueueView; deskId?: string | null; bayId?: string | null }): void => {
      const sp = new URLSearchParams(searchParams.toString());
      const nextView = next.view ?? view;
      sp.set('view', nextView);
      const nextDesk = next.deskId === undefined ? deskId : next.deskId;
      if (nextView === 'desk' && nextDesk !== null) {
        sp.set('deskId', nextDesk);
      } else {
        sp.delete('deskId');
      }
      // Lo sportello scelto resta nell'indirizzo accanto alla sua area: l'area decide quali
      // pratiche si vedono, lo sportello decide di chi è il banco che si sta guardando. Servono
      // tutt'e due, perché due sportelli condividono la stessa area e la stessa coda.
      const nextBay = next.bayId === undefined ? null : next.bayId;
      if (nextView === 'desk' && nextBay !== null) {
        sp.set('bayId', nextBay);
      } else if (next.bayId !== undefined || nextView !== 'desk') {
        sp.delete('bayId');
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, view, deskId],
  );

  /** Dopo una presa in carico riuscita: ispezione su tablet, pannello di dettaglio su schermo grande. */
  const dopoPresaInCarico = useCallback(
    (appointmentId: string): void => {
      if (touchLayout) {
        transizione.push(checkInPath(appointmentId));
        return;
      }
      setSelectedId(appointmentId);
    },
    [transizione, touchLayout],
  );

  const onAction = useCallback(
    (appointmentId: string, action: AppointmentAction, expectedVersion: number): void => {
      const contraria = AZIONE_CONTRARIA[action];
      actions.run(
        appointmentId,
        { action, expectedVersion },
        {
          onSuccess: (appointment) => {
            // Anche la riapertura rimette la pratica in carico: stesso seguito della presa in carico.
            if (action === 'take' || action === 'reopen-completed') {
              dopoPresaInCarico(appointmentId);
            }
            // Sul tablet la presa in carico porta subito al check-in: un avviso su una schermata
            // che si sta lasciando non lo leggerebbe nessuno.
            const siCambiaSchermata =
              touchLayout && (action === 'take' || action === 'reopen-completed');
            if (contraria === undefined || siCambiaSchermata) {
              setAnnullabile(null);
              return;
            }
            setAnnullabile({
              messaggio: `${appointment.code} ${ESITO_ANNULLABILE[action] ?? 'aggiornata'}`,
              appointmentId,
              // La versione è cambiata con l'azione appena riuscita: l'annullamento deve partire
              // da quella nuova, altrimenti il server risponde 409 a un comando che è nostro.
              version: appointment.version,
              contraria,
            });
          },
        },
      );
    },
    [actions, dopoPresaInCarico, touchLayout],
  );

  /** Il tempo per cambiare idea è finito, o l'operatore ha fatto altro: l'avviso sparisce. */
  const chiudiAnnullamento = useCallback((): void => {
    setAnnullabile(null);
  }, []);

  /** Manda l'azione contraria. Non trattiene niente: quella di prima è già sul server. */
  const annulla = useCallback((): void => {
    if (annullabile === null) {
      return;
    }
    const { appointmentId, version, contraria } = annullabile;
    setAnnullabile(null);
    actions.run(appointmentId, { action: contraria, expectedVersion: version });
  }, [actions, annullabile]);

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

  /*
   * Il selettore degli sportelli: i quattro banchi fisici, uno per uno, con accanto chi ci sta
   * seduto. Prima offriva le due AREE di marchio («FCA · Sportelli A e B»), che è l'unità con cui
   * la coda è divisa ma non è quello che un accettatore chiama «il mio sportello»: lui sta al
   * banco B, e il collega di fianco al banco A.
   *
   * L'area resta l'intestazione del gruppo, e non per ordine: A e B guardano la STESSA coda, ed è
   * una verità del dominio, non un difetto. Scritta così si vede scegliendo; nascosta, chi prova A
   * e poi B vedrebbe due volte lo stesso elenco e penserebbe che il filtro è rotto.
   */
  const bays = data?.bays ?? [];
  const bayDiSessione =
    data?.workstations.find((w) => w.id === session.workstationId)?.defaultBayId ?? null;
  const bayScelto =
    searchParams.get('bayId') ??
    (bayDiSessione !== null && bays.some((b) => b.bay.id === bayDiSessione)
      ? bayDiSessione
      : (bays.find((b) => b.deskId === deskId)?.bay.id ?? ''));
  const gruppiSportelli = desks
    .map((d) => ({
      label: `${d.code} · ${d.name}${d.id === homeDeskId ? ' (mio)' : ''}`,
      options: bays
        .filter((b) => b.deskId === d.id)
        .map((b) => ({
          id: b.bay.id,
          // «libero» dice che il banco non ha nessuno: è l'informazione che serve a chi cerca un
          // collega, e a chi cerca un posto dove sedersi.
          label: `${b.bay.name} · ${b.operatorName ?? 'libero'}`,
        })),
    }))
    .filter((g) => g.options.length > 0);
  /*
   * I quattro numeri della testata. Sono quelli su cui l'accettatore decide se è in pari o
   * indietro: chi aspetta, chi è sotto mano, chi è in ritardo e quanto si è chiuso. «Al check-in»
   * della tavola qui non è distinguibile — il check-in è una pratica in carico con le foto in
   * corso — e al suo posto c'è «in ritardo», che è la colonna su cui si interviene.
   */
  // Sezione chiesta da un contatore. Il contatore cambia da solo mentre la giornata va avanti,
  // quindi il nonce non è il numero: è quante volte l'hanno chiesta, altrimenti chiedere due volte
  // la stessa sezione con lo stesso numero non farebbe niente la seconda.
  const [vaiA, setVaiA] = useState<{ chiave: string; nonce: number } | null>(null);
  const vaiASezione = useCallback((sezione: string): void => {
    setVaiA((corrente) => ({ chiave: sezione, nonce: (corrente?.nonce ?? 0) + 1 }));
  }, []);

  const contatori = useMemo(() => {
    const righe = data?.rows ?? [];
    const inCoda = righe.filter(
      (r) => r.appointment.status === 'WAITING' || r.appointment.status === 'SKIPPED',
    );
    const adesso = data?.serverTime ?? new Date().toISOString();
    const inRitardo = inCoda.filter((r) =>
      isLate(r.appointment, adesso, LATE_GRACE_MINUTES),
    ).length;
    return [
      {
        etichetta: 'in attesa',
        valore: inCoda.length - inRitardo,
        riga: 'bg-status-waiting',
        sezione: 'queued',
      },
      {
        etichetta: 'in carico',
        valore: righe.filter((r) => r.appointment.status === 'IN_PROGRESS').length,
        riga: 'bg-status-in-progress',
        sezione: 'in-progress',
      },
      { etichetta: 'in ritardo', valore: inRitardo, riga: 'bg-priority-late', sezione: 'late' },
      {
        etichetta: 'chiuse',
        valore: righe.filter((r) =>
          ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(r.appointment.status),
        ).length,
        riga: 'bg-status-completed',
        sezione: 'closed',
      },
    ];
  }, [data?.rows, data?.serverTime]);

  /*
   * Il sottotitolo nomina il banco che si sta guardando e, se ne condivide la coda con un altro,
   * lo dice: «Sportello B · coda condivisa con A». Chi sceglie B e poi A vedrebbe altrimenti due
   * volte lo stesso elenco senza capirne il motivo, e concluderebbe che il selettore non funziona.
   */
  const bayCorrente = bays.find((b) => b.bay.id === bayScelto) ?? null;
  const compagni = bays
    .filter((b) => b.deskId === bayCorrente?.deskId && b.bay.id !== bayCorrente?.bay.id)
    .map((b) => b.bay.code);
  const deskLabel =
    view === 'global'
      ? 'tutti gli sportelli'
      : bayCorrente === null
        ? (desks.find((d) => d.id === deskId)?.name ?? 'sportello')
        : `${bayCorrente.bay.name}${compagni.length > 0 ? ` · coda condivisa con ${compagni.join(' e ')}` : ''}`;

  const outcome = actions.outcome;
  const selectedRow = data?.rows.find((r) => r.appointment.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <QueueHeader
        title={view === 'returns' ? 'Riconsegne veicoli' : 'Coda accettazione'}
        subtitle={
          data === undefined
            ? 'Caricamento…'
            : `${formatBusinessDate(data.businessDate)} · ${
                view === 'returns' ? 'commesse in consegna, fuori dalla coda' : deskLabel
              }`
        }
        view={view}
        returnsCount={data?.returnsCount ?? 0}
        counters={contatori}
        onCounter={vaiASezione}
        onView={(prossima) =>
          updateUrl({ view: prossima, deskId: prossima === 'desk' ? homeDeskId : null })
        }
        deskPicker={{
          value: bayScelto,
          groups: gruppiSportelli,
          onChange: (bayId) => {
            const scelto = bays.find((b) => b.bay.id === bayId) ?? null;
            updateUrl({ deskId: scelto?.deskId ?? deskId, bayId });
          },
        }}
        actions={
          manualIntakeEnabled && !readOnly ? (
            <Button variant="outline" onClick={() => setNuovoCliente(true)}>
              + Pratica manuale
            </Button>
          ) : null
        }
        badges={
          <>
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
          </>
        }
      />

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
            bays={data.bays}
            homeDeskId={homeDeskId}
            showDesk={view === 'global' || currentDesk?.id !== homeDeskId}
            timeZone={data.timeZone}
            serverTime={data.serverTime}
            pendingId={actions.pendingId}
            currentOperatorName={session.displayName}
            onAction={onAction}
            selectedId={selectedId}
            readOnly={readOnly}
            vaiA={vaiA}
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
        <p className="text-ink-muted text-xs">
          Aggiornamento automatico ogni 3 secondi · ultimo dato dal server:{' '}
          {formatDateTimeIt(data.serverTime, data.timeZone)}
        </p>
      ) : null}

      <UndoToast
        message={annullabile?.messaggio ?? null}
        resetKey={
          annullabile === null ? null : `${annullabile.appointmentId}:${annullabile.version}`
        }
        onUndo={annulla}
        onDismiss={chiudiAnnullamento}
      />

      <AppointmentDetailPanel
        row={selectedRow}
        presentation={touchLayout ? 'modal' : 'side'}
        allowCheckIn={touchLayout}
        brandName={
          selectedRow === null
            ? ''
            : (data?.brands.find((b) => b.id === selectedRow.appointment.brandId)?.name ?? '')
        }
        deskLabel={selectedRow === null ? null : sportelloLabel(selectedRow, desks, bays)}
        timeZone={data?.timeZone ?? 'Europe/Rome'}
        currentOperatorName={session.displayName}
        debugCustomerLink={debugCustomerLink}
        // Vincolo legale e chiusura commessa: solo l'amministratore, che qui monitora in sola
        // lettura. Dopo il cambio si ricarica la coda, così il pannello — che legge dalla riga —
        // mostra subito il nuovo stato.
        retention={
          selectedRow !== null && canAccess('admin', session.role)
            ? {
                onChange: async (patch) => {
                  await patchAppointmentRetention(selectedRow.appointment.id, patch);
                  await queryClient.invalidateQueries({ queryKey: queueKeys.all });
                },
              }
            : undefined
        }
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
