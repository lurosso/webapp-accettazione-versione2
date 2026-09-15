// Testi dei messaggi al cliente (italiano) e chiavi dei template Spoki approvati da Meta.

import type { Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { NotificationKind } from '@/domain/entities/notification';
import { localTimeHHmm } from '@/lib/dates';

/** Variabili disponibili nei template. */
export interface TemplateVars {
  readonly firstName: string;
  readonly code: string;
  readonly scheduledTime: string;
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
  REMINDER_MORNING: {
    spokiTemplateKey: 'reminder_morning_v1',
    render: (v) =>
      `Buongiorno ${v.firstName}, le ricordiamo l'appuntamento di oggi alle ${v.scheduledTime} presso Autoclub Group per la vettura ${v.plate}. Il suo codice è ${v.code}.`,
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
  return {
    firstName: appointment.customer.firstName,
    code: appointment.code,
    scheduledTime: localTimeHHmm(new Date(appointment.scheduledAt), timeZone),
    plate: appointment.vehicle.plate,
    brandName: brand.name,
    portalUrl: buildPortalUrl(publicBaseUrl, appointment.vehicle.plate),
  };
}
