'use client';

// Pannello laterale con i dettagli completi della pratica, aperto dal clic sulla riga della coda.
// Serve all'accettatore per chiamare il cliente che non si presenta: il telefono è un link
// `tel:` così da un tablet o da un softphone parte la chiamata con un tocco.
// I dati arrivano dalla riga già scaricata (`/api/v1/queue`), quindi il pannello si apre subito
// e continua ad aggiornarsi con il polling della coda, senza una richiesta dedicata.
import { useEffect } from 'react';
import type { Appointment } from '@/domain/entities/appointment';
import { customerFullName } from '@/domain/entities/customer';
import type { NotificationJobStatus } from '@/domain/entities/notification';
import type { QueueRowView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OperatorChip } from '@/components/shared/OperatorChip';
import { formatDateTimeIt, localTimeHHmm } from '@/lib/dates';
import { NotificationBadge } from './NotificationBadge';
import { StatusBadge } from './StatusBadge';

export interface AppointmentDetailPanelProps {
  readonly row: QueueRowView | null;
  readonly brandName: string;
  readonly deskLabel: string | null;
  readonly timeZone: string;
  /** Operatore collegato: serve a marcare "(tu)" sulla presa in carico. */
  readonly currentOperatorName: string;
  readonly onClose: () => void;
}

/** Riga etichetta/valore del pannello. */
function Field({
  label,
  children,
  mono = false,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className={mono ? 'font-mono text-sm text-slate-900' : 'text-sm text-slate-900'}>
        {children}
      </dd>
    </div>
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
}: AppointmentDetailPanelProps) {
  // Chiusura con Esc: l'accettatore lavora molto da tastiera.
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

  const a = row.appointment;
  const phone = a.customer.phone;
  const events = timeline(a);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="dettaglio-titolo"
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-2xl font-bold tracking-wide" id="dettaglio-titolo">
              {a.code}
            </span>
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
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Chiudi dettaglio">
            Chiudi
          </Button>
        </header>

        <div className="flex flex-col gap-6 px-5 py-4">
          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-900">Cliente</h3>
            <dl>
              <Field label="Nome e cognome">{customerFullName(a.customer)}</Field>
              <Field label="Telefono" mono>
                {phone === null ? (
                  <span className="text-slate-500">
                    Non disponibile in agenda: contattare tramite lo sportello
                  </span>
                ) : (
                  <a href={`tel:${phone}`} className="font-semibold text-slate-900 underline">
                    {phone}
                  </a>
                )}
              </Field>
              {a.customer.email !== null ? (
                <Field label="Email">
                  <a href={`mailto:${a.customer.email}`} className="underline">
                    {a.customer.email}
                  </a>
                </Field>
              ) : null}
              <Field label="Consenso WhatsApp">
                {a.customer.whatsappOptIn ? (
                  <Badge tone="success">Sì, promemoria via WhatsApp</Badge>
                ) : (
                  <Badge tone="neutral">No, solo SMS o telefono</Badge>
                )}
              </Field>
              {/* Esito del promemoria: qui e non nella tabella, perché è l'informazione che
                  serve proprio quando si sta decidendo se telefonare al cliente. */}
              <Field label="Promemoria di oggi">
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
          </section>

          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-900">Veicolo</h3>
            <dl>
              <Field label="Targa" mono>
                <span className="text-base font-bold">{a.vehicle.plate}</span>
              </Field>
              <Field label="Marca e modello">
                {brandName} {a.vehicle.model}
              </Field>
              {a.vehicle.vin !== null ? (
                <Field label="Telaio (VIN)" mono>
                  {a.vehicle.vin}
                </Field>
              ) : null}
            </dl>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-bold text-slate-900">Appuntamento</h3>
            <dl>
              <Field label="Orario di prenotazione" mono>
                {localTimeHHmm(new Date(a.scheduledAt), timeZone)}
              </Field>
              <Field label="Lavorazione richiesta">
                {a.serviceDescription ?? <span className="text-slate-500">Non indicata</span>}
              </Field>
              <Field label="Note">
                {a.notes ?? <span className="text-slate-500">Nessuna nota</span>}
              </Field>
              <Field label="Sportello">
                {deskLabel ?? <span className="text-slate-500">Non assegnato</span>}
              </Field>
              <Field label="Campata">
                {row.bayCode ?? <span className="text-slate-500">Nessuna</span>}
              </Field>
              <Field label="Presa in carico da">
                {row.operatorName === null ? (
                  <span className="text-slate-500">Nessuno</span>
                ) : (
                  <OperatorChip
                    displayName={row.operatorName}
                    isCurrent={row.operatorName === currentOperatorName}
                  />
                )}
              </Field>
              <Field label="Origine">
                {a.source === 'INFINITY'
                  ? `Agenda Infinity${a.externalRef === null ? '' : ` (rif. ${a.externalRef})`}`
                  : 'Inserimento manuale in officina'}
              </Field>
            </dl>
          </section>

          {events.length > 0 ? (
            <section>
              <h3 className="mb-1 text-sm font-bold text-slate-900">Cronologia di oggi</h3>
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
            </section>
          ) : null}

          <p className="text-xs text-slate-400">
            Ultimo aggiornamento della pratica: {formatDateTimeIt(a.updatedAt, timeZone)}
          </p>
        </div>
      </aside>
    </div>
  );
}
