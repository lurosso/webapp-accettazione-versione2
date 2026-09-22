// Esito del contatto con il cliente, accanto al suo nome nella coda.
// All'accettatore serve una risposta immediata a una domanda sola: "il cliente è stato avvisato?".
// Per questo l'indicatore è piccolo ma esplicito, e distingue il canale usato: WhatsApp, SMS di
// ripiego o contatto manuale. Gli stati che richiedono un'azione sono gli unici a usare il rosso.
import type { NotificationJobStatus } from '@/domain/entities/notification';
import { cn } from '@/lib/utils/cn';

export interface NotificationBadgeProps {
  readonly status: NotificationJobStatus | null;
  readonly className?: string | undefined;
}

interface BadgeCopy {
  /** Simbolo compatto: si legge anche a colpo d'occhio su una riga densa. */
  readonly icon: string;
  readonly label: string;
  readonly title: string;
  readonly classes: string;
}

const COPY: Record<NotificationJobStatus, BadgeCopy> = {
  PENDING: {
    icon: '⋯',
    label: 'in attesa',
    title: 'Promemoria in coda di invio',
    classes: 'bg-slate-100 text-slate-600 ring-slate-300',
  },
  IN_FLIGHT: {
    icon: '⋯',
    label: 'invio',
    title: 'Invio del promemoria in corso',
    classes: 'bg-slate-100 text-slate-600 ring-slate-300',
  },
  SENT: {
    icon: '✓',
    label: 'WhatsApp',
    title: 'Messaggio inviato via WhatsApp (consegna non ancora confermata)',
    classes: 'bg-status-completed-soft text-status-completed-ink ring-status-completed/50',
  },
  DELIVERED: {
    icon: '✓✓',
    label: 'WhatsApp',
    title: 'Messaggio consegnato via WhatsApp',
    classes: 'bg-status-completed-soft text-status-completed-ink ring-status-completed',
  },
  READ: {
    icon: '✓✓',
    label: 'letto',
    title: 'Messaggio letto dal cliente su WhatsApp',
    classes: 'bg-status-info-soft text-status-info-ink ring-status-info/40',
  },
  FAILED: {
    icon: '!',
    label: 'da ritentare',
    title:
      'Invio non riuscito per un problema temporaneo: sarà ritentato, oppure contattare il cliente',
    classes: 'bg-status-no-show-soft text-status-no-show-ink ring-status-no-show/50',
  },
  MANUAL_REQUIRED: {
    icon: '☎',
    label: 'chiamare',
    title: 'WhatsApp e SMS non riusciti: contattare il cliente al telefono',
    classes: 'bg-status-no-show-soft text-status-no-show-ink ring-status-no-show',
  },
  MANUAL_CONFIRMED: {
    icon: '☎',
    label: 'contattato',
    title: 'Cliente contattato a mano da un operatore',
    classes: 'bg-status-info-soft text-status-info-ink ring-status-info/40',
  },
  NO_RECIPIENT: {
    icon: '−',
    label: 'senza numero',
    title: 'Nessun recapito telefonico in agenda: il cliente non può essere avvisato',
    classes: 'bg-status-in-progress-soft text-status-in-progress-ink ring-status-in-progress/50',
  },
  SUPPRESSED: {
    icon: '−',
    label: 'non inviato',
    title: 'Invio sospeso per scelta di configurazione',
    classes: 'bg-slate-100 text-slate-600 ring-slate-300',
  },
};

/** Etichetta per l'SMS: lo stato non distingue il canale, lo fa il chiamante. */
const SMS_COPY: BadgeCopy = {
  icon: '✓',
  label: 'SMS',
  title: 'WhatsApp non riuscito: promemoria inviato via SMS',
  classes: 'bg-status-info-soft text-status-info-ink ring-status-info/40',
};

export interface NotificationBadgeFullProps extends NotificationBadgeProps {
  /** Canale dell'ultimo tentativo: distingue l'SMS di ripiego dal WhatsApp riuscito. */
  readonly channel?: 'WHATSAPP' | 'SMS' | 'MANUAL' | null;
}

export function NotificationBadge({ status, channel, className }: NotificationBadgeFullProps) {
  if (status === null) {
    return null;
  }
  const base = COPY[status];
  const copy =
    channel === 'SMS' && (status === 'SENT' || status === 'DELIVERED' || status === 'READ')
      ? SMS_COPY
      : base;

  return (
    <span
      title={copy.title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1',
        copy.classes,
        className,
      )}
    >
      <span aria-hidden="true">{copy.icon}</span>
      <span>{copy.label}</span>
    </span>
  );
}
