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
    title: 'Promemoria inviato via WhatsApp (consegna non ancora confermata)',
    classes: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  },
  DELIVERED: {
    icon: '✓✓',
    label: 'WhatsApp',
    title: 'Promemoria consegnato via WhatsApp',
    classes: 'bg-status-completed-soft text-emerald-900 ring-emerald-400',
  },
  FAILED: {
    icon: '!',
    label: 'da ritentare',
    title:
      'Invio non riuscito per un problema temporaneo: sarà ritentato, oppure contattare il cliente',
    classes: 'bg-status-no-show-soft text-red-800 ring-red-300',
  },
  MANUAL_REQUIRED: {
    icon: '☎',
    label: 'chiamare',
    title: 'WhatsApp e SMS non riusciti: contattare il cliente al telefono',
    classes: 'bg-status-no-show-soft text-red-800 ring-red-400',
  },
  MANUAL_CONFIRMED: {
    icon: '☎',
    label: 'contattato',
    title: 'Cliente contattato a mano da un operatore',
    classes: 'bg-sky-50 text-sky-800 ring-sky-300',
  },
  NO_RECIPIENT: {
    icon: '−',
    label: 'senza numero',
    title: 'Nessun recapito telefonico in agenda: il cliente non può essere avvisato',
    classes: 'bg-amber-50 text-amber-900 ring-amber-300',
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
  classes: 'bg-sky-50 text-sky-800 ring-sky-300',
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
  const copy = channel === 'SMS' && (status === 'SENT' || status === 'DELIVERED') ? SMS_COPY : base;

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
