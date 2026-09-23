// Stato dell'ultimo WhatsApp al cliente, come lo racconta Spoki: inviato, consegnato, letto o non
// consegnato. Sta accanto alla pratica in coda e in archivio, perché la domanda dell'accettatore
// è una sola — «il cliente ha ricevuto il messaggio?» — e la risposta deve stare in una parola.
import type { WhatsAppDelivery, WhatsAppDeliveryState } from '@/domain/entities/appointment';
import type { NotificationKind } from '@/domain/entities/notification';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { formatDateTimeIt } from '@/lib/dates';

export interface WhatsAppBadgeProps {
  readonly delivery: WhatsAppDelivery | null;
  readonly timeZone: string;
  readonly className?: string | undefined;
}

interface Copy {
  readonly icon: string;
  readonly label: string;
  readonly tone: BadgeTone;
}

const COPY: Readonly<Record<WhatsAppDeliveryState, Copy>> = {
  SENT: { icon: '✓', label: 'WhatsApp inviato', tone: 'neutral' },
  DELIVERED: { icon: '✓✓', label: 'WhatsApp consegnato', tone: 'success' },
  READ: { icon: '✓✓', label: 'WhatsApp letto', tone: 'info' },
  FAILED: { icon: '!', label: 'WhatsApp non consegnato', tone: 'danger' },
};

/** Come si chiama il messaggio nel suggerimento al passaggio del mouse. */
export const WHATSAPP_KIND_LABELS: Readonly<Record<NotificationKind, string>> = {
  REMINDER_PREVIOUS_DAY: 'promemoria del giorno prima',
  REMINDER_SAME_DAY: 'promemoria del giorno',
  CHECK_IN_STARTED: 'benvenuto con il link al portale',
  CHECK_IN_COMPLETED: 'accettazione completata',
  ARRIVAL_CONFIRMED: 'conferma di arrivo con smart link',
  LATE_CONFIRMED: 'conferma del ritardo',
  ABSENT_CONFIRMED: 'conferma dell’annullamento',
  BOOKING_CONFIRMED: 'conferma della pratica',
  TURN_APPROACHING: 'turno in arrivo',
  YOUR_TURN: 'è il suo turno',
  APPOINTMENT_CANCELLED: 'annullamento',
  VEHICLE_READY: 'vettura pronta',
  CUSTOM: 'messaggio libero',
};

export function WhatsAppBadge({ delivery, timeZone, className }: WhatsAppBadgeProps) {
  if (delivery === null) {
    return null;
  }
  const copy = COPY[delivery.state];
  return (
    <Badge
      tone={copy.tone}
      className={className}
      data-testid="whatsapp-stato"
      data-stato={delivery.state}
      title={`${copy.label}: ${WHATSAPP_KIND_LABELS[delivery.kind]} · ${formatDateTimeIt(delivery.at, timeZone)}`}
    >
      <span aria-hidden="true">{copy.icon}</span>
      <span>{copy.label}</span>
    </Badge>
  );
}
