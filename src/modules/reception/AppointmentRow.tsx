'use client';

// Riga della coda: codice in evidenza, orario, targa, veicolo, cliente, sportello (vista globale),
// stato, campata, operatore e azioni. Lo stato si legge dalla pastiglia; lo sfondo della riga è
// riservato alla priorità (vedi `ROW_CLASSES`).
// L'intera riga apre il dettaglio della pratica; il codice è anche un pulsante, così il pannello
// si raggiunge da tastiera e con gli screen reader, non solo col mouse.
import {
  effectiveScheduleTime,
  isAutoClosedPending,
  isInQueue,
  type AppointmentStatus,
} from '@/domain/entities/appointment';
import type { QueueRowView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { OperatorChip } from '@/components/shared/OperatorChip';
import { TableCell, TableRow } from '@/components/ui/table';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { ActionButtons } from './ActionButtons';
import { StatusBadge } from './StatusBadge';
import type { AppointmentAction } from './types';

export interface AppointmentRowProps {
  readonly row: QueueRowView;
  readonly brandName: string;
  readonly deskLabel: string | null;
  readonly showDesk: boolean;
  readonly foreignDesk: boolean;
  readonly timeZone: string;
  readonly pending: boolean;
  /** Nome dell'operatore collegato: marca con "(tu)" le pratiche prese in carico da lui. */
  readonly currentOperatorName: string;
  /** Riga del blocco "in ritardo": aggiunge le azioni per gestire il ritardo. */
  readonly late?: boolean;
  /** Minuti di ritardo accumulati, mostrati accanto all'orario. */
  readonly lateByMinutes?: number;
  /** Orario atteso superato ma entro la tolleranza: riga gialla, "da servire ora". */
  readonly dueSoon?: boolean;
  /** Cambiata negli ultimi secondi: sale al suo posto invece di comparire e basta. */
  readonly appenaCambiata?: boolean;
  readonly onAction: (action: AppointmentAction) => void;
  readonly onSelect: () => void;
  /** Riga aperta nel pannello di dettaglio. */
  readonly selected?: boolean;
  /**
   * Sola lettura: la riga mostra tutto ma non offre azioni. È la vista di monitoraggio
   * dell'amministratore, che guarda come sta andando l'officina senza rischiare di toccare la
   * pratica di un collega mentre scorre l'elenco.
   */
  readonly readOnly?: boolean;
}

/*
 * Lo sfondo della riga NON dice più lo stato: lo dice la pastiglia, che è dove si guarda.
 *
 * Prima ogni stato tingeva la riga e la coda diventava una fila di strisce gialle, arancioni,
 * verdi e rosse: con cinque colori accesi contemporaneamente non ne emergeva nessuno, ed è
 * l'opposto di quello che serve a chi deve capire in un secondo chi chiamare adesso. Adesso il
 * fondo è bianco per tutte e il colore resta alla PRIORITÀ (vedi sotto), che è una cosa sola per
 * volta. Le pratiche in carico stanno già nel loro blocco in cima: non serve ripeterlo col colore.
 */
const ROW_CLASSES: Partial<Record<AppointmentStatus, string>> = {
  CANCELLED: 'text-ink-muted',
};

export function AppointmentRow({
  row,
  brandName,
  deskLabel,
  showDesk,
  foreignDesk,
  timeZone,
  pending,
  currentOperatorName,
  late = false,
  lateByMinutes = 0,
  dueSoon = false,
  appenaCambiata = false,
  onAction,
  onSelect,
  selected = false,
  readOnly = false,
}: AppointmentRowProps) {
  const a = row.appointment;
  // Il cliente ha avvisato dal portale che arriva in ritardo: avviso ambra finché è in coda.
  const avvisoRitardo = a.customerLateNoticeAt !== null && isInQueue(a.status);
  // Il cliente si è annunciato («Sono arrivato» dalla pagina o da WhatsApp): è in fila fuori, in
  // auto, e chi chiama il prossimo deve saperlo senza aprire il dettaglio.
  const inFila = a.customerArrivedAt !== null && isInQueue(a.status);
  return (
    <TableRow
      className={cn(
        // Riga interamente toccabile: sul tablet si apre il dettaglio con il dito, senza mirare
        // il codice. `select-none` evita che il tocco prolungato selezioni il testo invece di
        // aprire il pannello.
        'cursor-pointer transition-[filter] duration-200 select-none hover:brightness-[0.97]',
        ROW_CLASSES[a.status],
        appenaCambiata && 'appena-cambiata',
        // Il colore va solo dove aggiunge qualcosa. Le pratiche in ritardo stanno già dentro un
        // blocco con il bordo e il titolo rossi: ritingere anche ogni riga faceva un muro rosa in
        // cui, di nuovo, non emergeva niente. Resta l'ambra su chi ha superato l'orario ma è
        // ancora dentro la tolleranza: quella è l'unica riga della coda che chiede qualcosa adesso.
        dueSoon && !late && 'bg-priority-now-soft',
        pending && 'opacity-60',
        selected && 'ring-brand-secondary ring-2 ring-inset',
      )}
      aria-selected={selected}
      data-status={a.status}
      onClick={onSelect}
    >
      <TableCell className="font-mono text-base font-bold tracking-wide">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className="focus-anello controllo -mx-2 inline-flex items-center rounded-sm px-2 underline decoration-slate-300 decoration-dotted underline-offset-4 hover:decoration-slate-900"
          aria-label={`Apri i dettagli della pratica ${a.code}, ${a.vehicle.plate}`}
        >
          {a.code}
        </button>
        {a.source === 'MANUAL' ? (
          <Badge tone="info" className="ml-2 align-middle">
            Manuale
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="font-mono whitespace-nowrap tabular-nums">
        {localTimeHHmm(new Date(effectiveScheduleTime(a)), timeZone)}
        {a.rescheduledAt !== null ? (
          <span
            className="text-ink-muted block text-xs font-normal"
            title={`Orario in agenda: ${localTimeHHmm(new Date(a.scheduledAt), timeZone)}`}
          >
            rimessa in coda
          </span>
        ) : null}
        {dueSoon ? (
          <span className="text-priority-now-ink block text-xs font-semibold">orario superato</span>
        ) : null}
        {inFila ? (
          <span
            className="text-status-completed block text-xs font-semibold"
            data-testid="cliente-in-fila"
            title={`Il cliente ha dichiarato di essere in fila alle ${localTimeHHmm(new Date(a.customerArrivedAt ?? a.updatedAt), timeZone)}`}
          >
            in fila dalle {localTimeHHmm(new Date(a.customerArrivedAt ?? a.updatedAt), timeZone)}
          </span>
        ) : null}
        {avvisoRitardo ? (
          <span
            className="text-priority-now-ink block text-xs font-semibold"
            title={`Avviso dal portale alle ${localTimeHHmm(new Date(a.customerLateNoticeAt ?? a.updatedAt), timeZone)}`}
          >
            cliente in ritardo · arrivo ~
            {a.customerEtaAt === null ? '?' : localTimeHHmm(new Date(a.customerEtaAt), timeZone)}
          </span>
        ) : null}
        {late && lateByMinutes > 0 ? (
          <span className="text-priority-late-ink block text-xs font-semibold whitespace-nowrap">
            {lateByMinutes < 60
              ? `+${lateByMinutes} min`
              : `+${Math.floor(lateByMinutes / 60)} h ${lateByMinutes % 60} min`}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="font-mono font-semibold">{a.vehicle.plate}</TableCell>
      <TableCell>
        <span className="font-medium">{brandName}</span>{' '}
        <span className="text-ink-muted">{a.vehicle.model}</span>
      </TableCell>
      {/* Colonna volutamente essenziale: l'esito del contatto sta nel pannello di dettaglio,
          dove l'accettatore lo cerca quando deve chiamare il cliente. */}
      <TableCell>
        {a.customer.lastName} {a.customer.firstName}
        {/* La lavorazione arriva da Infinity e può essere lunghissima: due righe in tabella, il
            resto nel pannello di dettaglio. Senza limite una sola riga occupava mezzo schermo di
            tablet e spingeva fuori vista tutte le altre pratiche. Niente `block` accanto a
            `line-clamp-2`: sovrascriverebbe il display -webkit-box che fa il troncamento. */}
        {a.serviceDescription !== null ? (
          <span className="text-ink-muted line-clamp-2 text-xs" title={a.serviceDescription}>
            {a.serviceDescription}
          </span>
        ) : null}
      </TableCell>
      {showDesk ? (
        <TableCell>
          <span className={cn(foreignDesk && 'text-ink-muted')}>{deskLabel ?? 'n/d'}</span>
        </TableCell>
      ) : null}
      <TableCell>
        <StatusBadge status={a.status} />
        {isAutoClosedPending(a) ? (
          <span className="text-priority-now-ink mt-0.5 block text-xs font-semibold">
            chiusa d&apos;ufficio · da confermare
          </span>
        ) : null}
        {a.skipCount > 0 ? (
          // "In attesa ×1" si leggeva come un conteggio dello stato: meglio dire cosa è successo.
          <span className="text-ink-muted mt-0.5 block text-xs">
            {a.skipCount === 1 ? 'saltata 1 volta' : `saltata ${a.skipCount} volte`}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="hidden font-mono xl:table-cell">
        {row.bayCode ?? (a.status === 'IN_PROGRESS' ? 'senza' : '—')}
      </TableCell>
      <TableCell className="hidden xl:table-cell">
        {row.operatorName === null ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <OperatorChip
            displayName={row.operatorName}
            isCurrent={row.operatorName === currentOperatorName}
          />
        )}
      </TableCell>
      <TableCell>
        {readOnly ? (
          <span className="text-ink-muted text-xs">sola lettura</span>
        ) : (
          // I pulsanti non devono aprire il pannello: l'azione è già esplicita.
          <div onClick={(event) => event.stopPropagation()}>
            <ActionButtons
              appointment={a}
              pending={pending}
              foreignDesk={foreignDesk}
              late={late}
              onAction={onAction}
            />
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
