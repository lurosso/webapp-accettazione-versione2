'use client';

// Dettagli completi della pratica, aperti dal clic (o dal tocco) sulla riga della coda.
// Due presentazioni della stessa scheda:
// - `side`: pannello laterale compatto per il banco, dove si lavora con mouse e tastiera e la
//   coda deve restare visibile di fianco;
// - `modal`: finestra centrale ariosa per il tablet, con testo più grande, campi a due colonne e
//   un solo pulsante di chiusura ben visibile, perché sul touch il pannello laterale denso era
//   scomodo da leggere e da chiudere.
// I dati arrivano dalla riga già scaricata (`/api/v1/queue`), quindi la scheda si apre subito e
// continua ad aggiornarsi con il polling della coda, senza una richiesta dedicata.
import { TransitionLink } from '@/components/layout/TransitionLink';
import { useEffect } from 'react';
import { isAutoClosedPending, isInQueue, type Appointment } from '@/domain/entities/appointment';
import { customerFullName } from '@/domain/entities/customer';
import type { NotificationJobStatus } from '@/domain/entities/notification';
import type { QueueRowView } from '@/domain/read-models';
import { MAX_SKIPS_BEFORE_ANOMALY } from '@/config/constants';
import { Badge } from '@/components/ui/badge';
import { ExpandableText } from '@/components/ui/expandable-text';
import { Button } from '@/components/ui/button';
import type { RetentionPatchInput } from '@/lib/api-client/client';
import { Conservazione, RiquadroConservazione } from './RetentionControls';
import { OperatorChip } from '@/components/shared/OperatorChip';
import { formatBusinessDateIt, formatDateTimeIt, localTimeHHmm } from '@/lib/dates';
import { checkInPath } from '@/lib/navigation';
import { cn } from '@/lib/utils/cn';
import { MediaGallery } from '@/modules/inspection-media/MediaGallery';
import { NotificationBadge } from './NotificationBadge';
import { StatusBadge } from './StatusBadge';
import { WhatsAppBadge } from './WhatsAppBadge';
import type { AppointmentAction } from './types';

export type DetailPresentation = 'side' | 'modal';

export interface AppointmentDetailPanelProps {
  readonly row: QueueRowView | null;
  readonly brandName: string;
  readonly deskLabel: string | null;
  readonly timeZone: string;
  /** Operatore collegato: serve a marcare "(tu)" sulla presa in carico. */
  readonly currentOperatorName: string;
  readonly onClose: () => void;
  /** `side` al banco (predefinito), `modal` sul tablet. */
  readonly presentation?: DetailPresentation;
  /**
   * Mostra il passaggio all'ispezione fotografica. Solo sul tablet: da un PC non si scattano
   * foto, e il pulsante porterebbe l'accettatore in una schermata che non può usare.
   */
  readonly allowCheckIn?: boolean;
  /** Azioni sulla pratica dal dettaglio (riapertura, conferma chiusura d'ufficio). */
  readonly onAction?: ((action: AppointmentAction) => void) | undefined;
  /** True per responsabili e amministratori: possono confermare una chiusura d'ufficio. */
  readonly canConfirmAutoClose?: boolean;
  readonly actionPending?: boolean;
  /**
   * Mostra la presa in carico per una pratica ancora in coda. Serve alla vista check-in del
   * tablet, dove il dettaglio si apre prima di iniziare e da lì si parte.
   */
  readonly showTake?: boolean;
  /**
   * Collegamento di servizio alla pagina di tracciamento del cliente (solo sviluppo, acceso da
   * `DEV_QUICK_LOGIN`): apre `/portal?targa=…` in una scheda nuova. Senza, per provare la pagina
   * del cliente bisognerebbe simulare un messaggio WhatsApp o copiare la targa a mano ogni volta.
   */
  readonly debugCustomerLink?: boolean;
  /**
   * Comandi sulla conservazione dei media — vincolo legale e chiusura della commessa — riservati
   * all'amministratore. Assente, il pannello dice lo stato (perché le foto ci sono ancora) ma non
   * offre pulsanti: l'accettatore deve poterlo leggere, non deciderlo.
   */
  readonly retention?:
    { readonly onChange: (patch: RetentionPatchInput) => Promise<void> } | undefined;
}

/** Riga etichetta/valore della scheda. */
function Field({
  label,
  children,
  mono = false,
  roomy = false,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly mono?: boolean;
  readonly roomy?: boolean;
}) {
  return (
    <div
      className={cn(
        'border-line-subtle flex flex-col border-b last:border-b-0',
        roomy ? 'gap-1 py-3' : 'gap-0.5 py-2',
      )}
    >
      <dt className="text-ink-muted text-xs font-semibold tracking-wide uppercase">{label}</dt>
      <dd
        className={cn(
          'text-ink',
          mono ? 'font-mono' : '',
          roomy ? 'text-base leading-snug' : 'text-sm',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** Sezione della scheda: sul tablet è un riquadro a sé, al banco un semplice blocco. */
function Section({
  title,
  modal,
  children,
}: {
  readonly title: string;
  readonly modal: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={modal ? 'bg-surface-sunken rounded-lg px-5 py-4' : undefined}>
      <h3 className={cn('text-ink font-bold', modal ? 'mb-2 text-base' : 'mb-2 text-sm')}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Cosa deve fare l'accettatore in base all'esito dell'ultimo messaggio. */
function notificationHint(status: NotificationJobStatus): string {
  switch (status) {
    case 'SENT':
    case 'DELIVERED':
      return 'Il cliente è stato avvisato: nessuna azione necessaria.';
    case 'READ':
      return 'Il cliente ha letto il messaggio.';
    case 'PENDING':
    case 'IN_FLIGHT':
      return 'Invio in corso.';
    case 'FAILED':
      return 'Invio non riuscito per un problema temporaneo: se il cliente non arriva, telefonagli.';
    case 'MANUAL_REQUIRED':
      return 'WhatsApp e SMS non sono riusciti: il cliente va chiamato al telefono.';
    case 'MANUAL_CONFIRMED':
      return 'Un operatore ha già contattato il cliente a voce.';
    case 'NO_RECIPIENT':
      return "In agenda non c'è un numero di telefono: il cliente non ha ricevuto avvisi.";
    case 'SUPPRESSED':
      return 'Invio sospeso dalla configurazione.';
  }
}

/** Elenco degli istanti registrati sulla pratica, in ordine di accadimento. */
function timeline(a: Appointment): readonly { label: string; at: string }[] {
  const entries: { label: string; at: string | null }[] = [
    { label: 'Presa in carico', at: a.takenAt },
    { label: 'Ultimo salto', at: a.skippedAt },
    { label: 'Completata', at: a.completedAt },
    { label: 'Segnata assente', at: a.noShowAt },
    { label: 'Annullata', at: a.cancelledAt },
  ];
  return entries.filter((e): e is { label: string; at: string } => e.at !== null);
}

export function AppointmentDetailPanel({
  row,
  brandName,
  deskLabel,
  timeZone,
  currentOperatorName,
  onClose,
  presentation = 'side',
  allowCheckIn = false,
  onAction,
  canConfirmAutoClose = false,
  actionPending = false,
  showTake = false,
  debugCustomerLink = false,
  retention,
}: AppointmentDetailPanelProps) {
  // Chiusura con Esc: al banco l'accettatore lavora molto da tastiera.
  useEffect(() => {
    if (row === null) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [row, onClose]);

  if (row === null) {
    return null;
  }

  const modal = presentation === 'modal';
  const a = row.appointment;
  const phone = a.customer.phone;
  const events = timeline(a);

  const dl = modal ? 'grid gap-x-8 sm:grid-cols-2' : undefined;

  return (
    <div
      className={cn(
        'fixed inset-0 z-40 flex bg-slate-900/40',
        modal ? 'items-center justify-center p-4 sm:p-8' : 'justify-end',
      )}
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="dettaglio-titolo"
        className={cn(
          'flex flex-col overflow-y-auto bg-white shadow-2xl',
          modal ? 'max-h-[90vh] w-full max-w-2xl rounded-2xl' : 'h-full w-full max-w-md',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          className={cn(
            'sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white',
            modal ? 'px-6 py-5' : 'px-5 py-4',
          )}
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-3">
              <span
                className={cn('font-mono font-bold tracking-wide', modal ? 'text-4xl' : 'text-2xl')}
                id="dettaglio-titolo"
              >
                {a.code}
              </span>
              {modal ? (
                <span className="font-mono text-2xl font-bold text-slate-700">
                  {a.vehicle.plate}
                </span>
              ) : null}
            </div>
            {modal ? (
              <span className="text-base text-slate-700">
                {customerFullName(a.customer)} · {brandName} {a.vehicle.model}
              </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={a.status} />
              {a.source === 'MANUAL' ? <Badge tone="info">Inserita a mano</Badge> : null}
              {a.skipCount >= MAX_SKIPS_BEFORE_ANOMALY && isInQueue(a.status) ? (
                <Badge tone="danger" dot>
                  Saltata {a.skipCount} volte · verificare presenza
                </Badge>
              ) : a.skipCount > 0 ? (
                <Badge tone="warning">
                  {a.skipCount === 1 ? 'Saltata 1 volta' : `Saltata ${a.skipCount} volte`}
                </Badge>
              ) : null}
            </div>
          </div>
          <Button
            variant={modal ? 'outline' : 'ghost'}
            size="touch"
            onClick={onClose}
            aria-label="Chiudi dettaglio"
            className={modal ? 'min-w-28' : undefined}
          >
            Chiudi
          </Button>
        </header>

        <div className={cn('flex flex-col', modal ? 'gap-4 px-6 py-5' : 'gap-6 px-5 py-4')}>
          {/* Pratica completata: si può riaprire (Completato premuto per errore, foto da rifare) e,
              se è una chiusura d'ufficio, un responsabile la conferma. */}
          {showTake && onAction !== undefined && isInQueue(a.status) ? (
            <Button
              variant="default"
              size="lg"
              className="w-full"
              disabled={actionPending}
              onClick={() => onAction('take')}
            >
              {allowCheckIn ? 'Inizia check-in' : 'Prendi in carico'}
            </Button>
          ) : null}

          {/* Cliente segnato assente che si presenta: torna in coda dopo chi è già in attesa. */}
          {a.status === 'NO_SHOW' && onAction !== undefined ? (
            <section className="border-status-no-show/30 bg-status-no-show-soft flex flex-col gap-3 rounded-xl border-2 p-4">
              <p className="text-status-no-show-ink text-sm">
                Segnato assente. Se il cliente si è presentato, riattivalo: torna in coda con
                l&apos;orario di adesso, dopo chi è già in attesa, e il BDC non lo richiamerà.
              </p>
              <Button
                variant="default"
                size="touch"
                disabled={actionPending}
                onClick={() => onAction('reactivate')}
              >
                Riattiva / Arrivato in ritardo
              </Button>
            </section>
          ) : null}

          {a.status === 'COMPLETED' && onAction !== undefined ? (
            <section
              className={cn(
                'flex flex-col gap-3 rounded-xl border-2 p-4',
                isAutoClosedPending(a)
                  ? 'border-status-in-progress/40 bg-status-in-progress-soft'
                  : 'border-slate-200 bg-slate-50',
              )}
            >
              {isAutoClosedPending(a) ? (
                <div className="flex flex-col gap-1">
                  <Badge tone="warning" className="self-start">
                    Chiusa d&apos;ufficio · da confermare
                  </Badge>
                  <p className="text-status-in-progress-ink text-sm">
                    Era ancora in carico alla chiusura automatica della giornata. Se il veicolo è
                    stato accettato davvero, conferma; altrimenti riaprila e concludi il check-in.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  Completata per errore, o foto da rifare? Riaprendola torna in carico a te.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="touch"
                  disabled={actionPending}
                  onClick={() => onAction('reopen-completed')}
                >
                  Riapri pratica / Modifica check-in
                </Button>
                {isAutoClosedPending(a) && canConfirmAutoClose ? (
                  <Button
                    variant="success"
                    size="touch"
                    disabled={actionPending}
                    onClick={() => onAction('confirm-auto-close')}
                  >
                    Conferma chiusura
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Passaggio manuale all'ispezione: solo dove si può fare, cioè sul tablet. */}
          {allowCheckIn && a.status === 'IN_PROGRESS' ? (
            <TransitionLink
              href={checkInPath(a.id)}
              className="bg-brand-secondary hover:bg-brand-blue-dark controllo-lg transizione premibile focus-anello testo-dato flex items-center justify-center rounded-xl px-4 font-semibold text-white"
            >
              Passa al check-in fotografico
            </TransitionLink>
          ) : null}

          {/*
           * Per l'amministratore la conservazione sta QUI, in alto e con il bordo colorato: è il
           * motivo per cui apre la pratica dal monitoraggio, e in fondo al pannello non la trovava.
           * Per gli altri ruoli resta in fondo, come informazione: leggono, non decidono.
           */}
          {retention !== undefined ? (
            <RiquadroConservazione a={a} timeZone={timeZone} retention={retention} />
          ) : null}

          <Section title="Cliente" modal={modal}>
            <dl className={dl}>
              <Field label="Nome e cognome" roomy={modal}>
                {customerFullName(a.customer)}
              </Field>
              <Field label="Telefono" mono roomy={modal}>
                {phone === null ? (
                  <span className="text-ink-muted">
                    Non disponibile in agenda: contattare tramite lo sportello
                  </span>
                ) : (
                  <a
                    href={`tel:${phone}`}
                    className={cn('font-semibold text-slate-900 underline', modal && 'text-lg')}
                  >
                    {phone}
                  </a>
                )}
              </Field>
              {a.customer.email !== null ? (
                <Field label="Email" roomy={modal}>
                  <a href={`mailto:${a.customer.email}`} className="underline">
                    {a.customer.email}
                  </a>
                </Field>
              ) : null}
              <Field label="Consenso WhatsApp" roomy={modal}>
                {a.customer.whatsappOptIn ? (
                  <Badge tone="success">Sì, promemoria via WhatsApp</Badge>
                ) : (
                  <Badge tone="neutral">No, solo SMS o telefono</Badge>
                )}
              </Field>
              {/* Esito dell'ultimo messaggio: qui e non nella tabella, perché è l'informazione
                  che serve proprio quando si sta decidendo se telefonare al cliente. */}
              <Field label="Ultimo messaggio al cliente" roomy={modal}>
                {row.notificationStatus === null ? (
                  <span className="text-ink-muted">Nessun messaggio inviato oggi</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    <NotificationBadge
                      status={row.notificationStatus}
                      channel={row.notificationChannel}
                      className="self-start"
                    />
                    <span className="text-ink-muted text-xs">
                      {notificationHint(row.notificationStatus)}
                    </span>
                  </span>
                )}
              </Field>
              {a.whatsapp !== null ? (
                <Field label="WhatsApp" roomy={modal}>
                  <WhatsAppBadge delivery={a.whatsapp} timeZone={timeZone} className="self-start" />
                </Field>
              ) : null}
            </dl>
          </Section>

          <Section title="Veicolo" modal={modal}>
            <dl className={dl}>
              <Field label="Targa" mono roomy={modal}>
                <span className="text-base font-bold">{a.vehicle.plate}</span>
              </Field>
              <Field label="Marca e modello" roomy={modal}>
                {brandName} {a.vehicle.model}
              </Field>
              {a.vehicle.vin !== null ? (
                <Field label="Telaio (VIN)" mono roomy={modal}>
                  {a.vehicle.vin}
                </Field>
              ) : null}
            </dl>
          </Section>

          <Section title="Appuntamento" modal={modal}>
            <dl className={dl}>
              <Field label="Orario di prenotazione" mono roomy={modal}>
                {localTimeHHmm(new Date(a.scheduledAt), timeZone)}
              </Field>
              {/* Lavorazione e note arrivano da Infinity e possono essere lunghissime: tre righe
                  e un comando che le apre sul posto, invece di un muro di testo che spinge le
                  azioni fuori dallo schermo del tablet. */}
              <Field label="Lavorazione richiesta" roomy={modal}>
                {a.serviceDescription === null ? (
                  <span className="text-ink-muted">Non indicata</span>
                ) : (
                  <ExpandableText lines={3} label="la lavorazione richiesta">
                    {a.serviceDescription}
                  </ExpandableText>
                )}
              </Field>
              <Field label="Note" roomy={modal}>
                {a.notes === null ? (
                  <span className="text-ink-muted">Nessuna nota</span>
                ) : (
                  <ExpandableText lines={3} label="le note sulla pratica">
                    {a.notes}
                  </ExpandableText>
                )}
              </Field>
              <Field label="Sportello" roomy={modal}>
                {deskLabel ?? <span className="text-ink-muted">Non assegnato</span>}
              </Field>
              <Field label="Accettazione" roomy={modal}>
                {row.bayCode ?? <span className="text-ink-muted">Nessuna</span>}
              </Field>
              <Field label="Accettatore assegnato (Infinity)" roomy={modal}>
                {a.assignedAdvisor === null ? (
                  <span className="text-ink-muted">Non indicato</span>
                ) : (
                  <span>
                    {a.assignedAdvisor.name ?? 'Accettatore'}{' '}
                    <span className="text-ink-muted testo-nota font-mono">
                      matricola {a.assignedAdvisor.code}
                    </span>
                  </span>
                )}
              </Field>
              <Field label="Riconsegna prevista (Infinity)" roomy={modal}>
                {a.expectedDelivery === null ? (
                  <span className="text-ink-muted">Non indicata</span>
                ) : (
                  <span className="tabular-nums">
                    {formatBusinessDateIt(a.expectedDelivery.date)}
                    {a.expectedDelivery.time === null ? '' : ` alle ${a.expectedDelivery.time}`}
                  </span>
                )}
              </Field>
              <Field label="Presa in carico da" roomy={modal}>
                {row.operatorName === null ? (
                  <span className="text-ink-muted">Nessuno</span>
                ) : (
                  <OperatorChip
                    displayName={row.operatorName}
                    isCurrent={row.operatorName === currentOperatorName}
                  />
                )}
              </Field>
              <Field label="Origine" roomy={modal}>
                {a.source === 'INFINITY'
                  ? `Agenda Infinity${a.externalRef === null ? '' : ` (rif. ${a.externalRef})`}`
                  : 'Inserimento manuale in officina'}
              </Field>
            </dl>
          </Section>

          {/* Ispezione al veicolo: note e foto scattate al tablet, dove servono a chi sta al banco. */}
          <MediaGallery appointmentId={a.id} inspectionNotes={a.notes} timeZone={timeZone} />

          {/* Perché quelle foto ci sono ancora: per chi non decide, l'informazione sta in fondo. */}
          {retention === undefined ? (
            <Section title="Conservazione dei media" modal={modal}>
              <Conservazione a={a} timeZone={timeZone} retention={undefined} />
            </Section>
          ) : null}

          {events.length > 0 ? (
            <details open={!modal} className="group">
              <summary
                className={cn(
                  'text-ink cursor-pointer list-none font-bold select-none',
                  modal ? 'controllo flex items-center text-base' : 'text-sm',
                )}
              >
                Cronologia di oggi
                <span className="text-ink-muted ml-2 text-xs font-normal group-open:hidden">
                  (tocca per aprire)
                </span>
              </summary>
              <ul className="flex flex-col gap-1 text-sm text-slate-700">
                {events.map((e) => (
                  <li key={e.label} className="flex justify-between gap-4">
                    <span>{e.label}</span>
                    <span className="font-mono text-slate-600 tabular-nums">
                      {localTimeHHmm(new Date(e.at), timeZone)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {debugCustomerLink === true ? (
            <a
              href={`/portal?targa=${encodeURIComponent(a.vehicle.plate)}`}
              target="_blank"
              rel="noreferrer"
              data-testid="link-tracciamento-cliente"
              className="border-status-in-progress bg-status-in-progress-soft text-status-in-progress-ink controllo focus-anello inline-flex items-center gap-2 rounded-md border border-dashed px-3 text-sm font-semibold"
            >
              <span aria-hidden="true">↗</span>
              Apri il tracciamento cliente (solo sviluppo)
            </a>
          ) : null}

          <p className="text-ink-muted text-xs">
            Ultimo aggiornamento della pratica: {formatDateTimeIt(a.updatedAt, timeZone)}
          </p>
        </div>

        {modal ? (
          <footer className="sticky bottom-0 border-t border-slate-200 bg-white px-6 py-4">
            <Button variant="default" size="lg" className="w-full" onClick={onClose}>
              Chiudi
            </Button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
