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
import Link from 'next/link';
import { useEffect } from 'react';
import { isAutoClosedPending, isInQueue, type Appointment } from '@/domain/entities/appointment';
import { customerFullName } from '@/domain/entities/customer';
import type { NotificationJobStatus } from '@/domain/entities/notification';
import type { QueueRowView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OperatorChip } from '@/components/shared/OperatorChip';
import { formatDateTimeIt, localTimeHHmm } from '@/lib/dates';
import { checkInPath } from '@/lib/navigation';
import { cn } from '@/lib/utils/cn';
import { MediaGallery } from '@/modules/inspection-media/MediaGallery';
import { NotificationBadge } from './NotificationBadge';
import { StatusBadge } from './StatusBadge';
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
        'flex flex-col border-b border-slate-100 last:border-b-0',
        roomy ? 'gap-1 py-3' : 'gap-0.5 py-2',
      )}
    >
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd
        className={cn(
          'text-slate-900',
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
    <section className={modal ? 'rounded-xl bg-slate-50 px-4 py-3' : undefined}>
      <h3 className={cn('font-bold text-slate-900', modal ? 'mb-1 text-base' : 'mb-1 text-sm')}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Cosa deve fare l'accettatore in base all'esito del promemoria. */
function notificationHint(status: NotificationJobStatus): string {
  switch (status) {
    case 'SENT':
    case 'DELIVERED':
      return 'Il cliente è stato avvisato: nessuna azione necessaria.';
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
              {a.skipCount > 0 ? (
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
              size="touch"
              className="min-h-14 w-full text-lg"
              disabled={actionPending}
              onClick={() => onAction('take')}
            >
              {allowCheckIn ? 'Inizia check-in' : 'Prendi in carico'}
            </Button>
          ) : null}

          {/* Cliente segnato assente che si presenta: torna in coda dopo chi è già in attesa. */}
          {a.status === 'NO_SHOW' && onAction !== undefined ? (
            <section className="flex flex-col gap-3 rounded-xl border-2 border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-900">
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
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-slate-200 bg-slate-50',
              )}
            >
              {isAutoClosedPending(a) ? (
                <div className="flex flex-col gap-1">
                  <Badge tone="warning" className="self-start">
                    Chiusa d&apos;ufficio · da confermare
                  </Badge>
                  <p className="text-sm text-amber-900">
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
            <Link
              href={checkInPath(a.id)}
              className="bg-brand-secondary hover:bg-brand-blue-dark focus-visible:ring-brand-blue-light flex min-h-14 items-center justify-center rounded-xl px-4 text-lg font-semibold text-white transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Passa al check-in fotografico
            </Link>
          ) : null}

          <Section title="Cliente" modal={modal}>
            <dl className={dl}>
              <Field label="Nome e cognome" roomy={modal}>
                {customerFullName(a.customer)}
              </Field>
              <Field label="Telefono" mono roomy={modal}>
                {phone === null ? (
                  <span className="text-slate-500">
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
              {/* Esito del promemoria: qui e non nella tabella, perché è l'informazione che
                  serve proprio quando si sta decidendo se telefonare al cliente. */}
              <Field label="Promemoria di oggi" roomy={modal}>
                {row.notificationStatus === null ? (
                  <span className="text-slate-500">Nessun promemoria inviato</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    <NotificationBadge
                      status={row.notificationStatus}
                      channel={row.notificationChannel}
                      className="self-start"
                    />
                    <span className="text-xs text-slate-500">
                      {notificationHint(row.notificationStatus)}
                    </span>
                  </span>
                )}
              </Field>
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
              <Field label="Lavorazione richiesta" roomy={modal}>
                {a.serviceDescription ?? <span className="text-slate-500">Non indicata</span>}
              </Field>
              <Field label="Note" roomy={modal}>
                {a.notes ?? <span className="text-slate-500">Nessuna nota</span>}
              </Field>
              <Field label="Sportello" roomy={modal}>
                {deskLabel ?? <span className="text-slate-500">Non assegnato</span>}
              </Field>
              <Field label="Accettazione" roomy={modal}>
                {row.bayCode ?? <span className="text-slate-500">Nessuna</span>}
              </Field>
              <Field label="Presa in carico da" roomy={modal}>
                {row.operatorName === null ? (
                  <span className="text-slate-500">Nessuno</span>
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

          {events.length > 0 ? (
            <details open={!modal} className="group">
              <summary
                className={cn(
                  'cursor-pointer list-none font-bold text-slate-900 select-none',
                  modal ? 'min-h-11 text-base leading-11' : 'text-sm',
                )}
              >
                Cronologia di oggi
                <span className="ml-2 text-xs font-normal text-slate-500 group-open:hidden">
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

          <p className="text-xs text-slate-400">
            Ultimo aggiornamento della pratica: {formatDateTimeIt(a.updatedAt, timeZone)}
          </p>
        </div>

        {modal ? (
          <footer className="sticky bottom-0 border-t border-slate-200 bg-white px-6 py-4">
            <Button
              variant="default"
              size="touch"
              className="min-h-14 w-full text-lg"
              onClick={onClose}
            >
              Chiudi
            </Button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
