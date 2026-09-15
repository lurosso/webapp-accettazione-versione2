// Testi dei messaggi al cliente (italiano) e chiavi dei template Spoki approvati da Meta.
//
// In questa fase l'integrazione WhatsApp copre due promemoria:
// - REMINDER_PREVIOUS_DAY, il giorno prima: data, orario, targa, codice, link al portale;
// - REMINDER_SAME_DAY, la mattina dell'appuntamento: orario, targa, codice.
// Gli altri tipi hanno il testo per SMS e log ma nessuna automazione Spoki.

import type { Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { NotificationKind } from '@/domain/entities/notification';
import { formatBusinessDateIt, localTimeHHmm, toBusinessDate } from '@/lib/dates';

/** Variabili disponibili nei template. */
export interface TemplateVars {
  readonly firstName: string;
  readonly lastName: string;
  /** Indirizzo e-mail del cliente, vuoto se assente (Spoki lo accetta vuoto). */
  readonly email: string;
  readonly code: string;
  /** Orario locale "HH:mm" dell'appuntamento. */
  readonly scheduledTime: string;
  /** Data locale "GG/MM/AAAA" dell'appuntamento. */
  readonly scheduledDate: string;
  readonly plate: string;
  readonly brandName: string;
  /** Link al portale cliente per seguire la coda (/portal?targa=…), già assoluto. */
  readonly portalUrl: string;
}

/** Link pubblico del portale per una targa. `publicBaseUrl` vuoto → percorso relativo. */
export function buildPortalUrl(publicBaseUrl: string, plate: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/portal?targa=${encodeURIComponent(plate)}`;
}

/** Definizione di un template: chiave Spoki e funzione di rendering del testo (per SMS e log). */
export interface NotificationTemplate {
  readonly spokiTemplateKey: string;
  render(vars: TemplateVars): string;
}

/** Template per tipo di notifica. */
export const NOTIFICATION_TEMPLATES: Readonly<Record<NotificationKind, NotificationTemplate>> = {
  REMINDER_PREVIOUS_DAY: {
    spokiTemplateKey: 'reminder_previous_day_v1',
    render: (v) =>
      `Buongiorno ${v.firstName}, le ricordiamo l'appuntamento di domani ${v.scheduledDate} alle ${v.scheduledTime} presso Autoclub Group per la vettura ${v.plate}. Il suo codice di accettazione è ${v.code}. Segua la coda in tempo reale: ${v.portalUrl}`,
  },
  REMINDER_SAME_DAY: {
    spokiTemplateKey: 'reminder_same_day_v1',
    render: (v) =>
      `Buongiorno ${v.firstName}, le ricordiamo l'appuntamento di oggi alle ${v.scheduledTime} presso Autoclub Group per la vettura ${v.plate}. Il suo codice di accettazione è ${v.code}.`,
  },
  BOOKING_CONFIRMED: {
    spokiTemplateKey: 'booking_confirmed_v1',
    render: (v) =>
      `${v.firstName}, la sua pratica per la vettura ${v.plate} è stata registrata presso Autoclub Group. Il suo codice è ${v.code}: lo troverà sui monitor dell'accettazione. Segua la coda in tempo reale: ${v.portalUrl}`,
  },
  TURN_APPROACHING: {
    spokiTemplateKey: 'turn_approaching_v1',
    render: (v) =>
      `${v.firstName}, il suo turno si avvicina: si prepari con il codice ${v.code} e si avvicini all'accettazione. Autoclub Group.`,
  },
  APPOINTMENT_CANCELLED: {
    spokiTemplateKey: 'appointment_cancelled_v1',
    render: (v) =>
      `${v.firstName}, la pratica ${v.code} per la vettura ${v.plate} è stata annullata. Per un nuovo appuntamento contatti Autoclub Group.`,
  },
  YOUR_TURN: {
    spokiTemplateKey: 'your_turn_v1',
    render: (v) =>
      `${v.firstName}, è il suo turno: si presenti in accettazione con il codice ${v.code}. Autoclub Group.`,
  },
  VEHICLE_READY: {
    spokiTemplateKey: 'vehicle_ready_v1',
    render: (v) =>
      `${v.firstName}, la sua ${v.brandName} ${v.plate} è pronta per il ritiro. Autoclub Group.`,
  },
  CUSTOM: {
    spokiTemplateKey: 'custom_v1',
    render: (v) => `${v.firstName}, messaggio da Autoclub Group relativo alla pratica ${v.code}.`,
  },
};

/** Costruisce le variabili del template a partire dalla pratica. */
export function buildTemplateVars(
  appointment: Appointment,
  brand: Brand,
  timeZone = 'Europe/Rome',
  publicBaseUrl = '',
): TemplateVars {
  const scheduled = new Date(appointment.scheduledAt);
  return {
    firstName: appointment.customer.firstName,
    lastName: appointment.customer.lastName,
    email: appointment.customer.email ?? '',
    code: appointment.code,
    scheduledTime: localTimeHHmm(scheduled, timeZone),
    scheduledDate: formatBusinessDateIt(toBusinessDate(scheduled, timeZone)),
    plate: appointment.vehicle.plate,
    brandName: brand.name,
    portalUrl: buildPortalUrl(publicBaseUrl, appointment.vehicle.plate),
  };
}
