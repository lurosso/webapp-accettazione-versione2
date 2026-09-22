// Testi dei messaggi al cliente (italiano) e chiavi dei template Spoki approvati da Meta.
//
// In questa fase l'integrazione WhatsApp copre il giro completo di una giornata:
// - REMINDER_PREVIOUS_DAY, il giorno prima: data, orario, targa, codice, link al portale;
// - REMINDER_SAME_DAY, la mattina dell'appuntamento: orario, targa, codice e le TRE risposte
//   rapide «Arrivato», «In ritardo», «Assente» (i pulsanti stanno nel template Spoki; qui c'è il
//   testo che li accompagna, che vale anche per l'SMS di ripiego, dove si risponde scrivendo);
// - ARRIVAL_CONFIRMED, la risposta a chi tocca «Arrivato»: codice in coda e link alla pagina di
//   tracciamento, che sostituisce il QR da inquadrare in officina;
// - CHECK_IN_STARTED, alla presa in carico allo sportello: benvenuto con il link PERSONALE al
//   portale (token della pratica), dove il cliente segue l'accettazione in tempo reale;
// - CHECK_IN_COMPLETED, a fine check-in (foto e video caricati): «Procedura di accettazione
//   completata. Grazie per la visita, puoi proseguire!».
// Gli altri tipi hanno il testo per SMS e log ma nessuna configurazione Spoki.

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

/**
 * Link pubblico del portale per una targa. `publicBaseUrl` vuoto → percorso relativo. Con il token
 * della pratica (`t`) il cliente entra dal link WhatsApp senza limiti di frequenza né enumerazione.
 */
export function buildPortalUrl(
  publicBaseUrl: string,
  plate: string,
  token: string | null = null,
): string {
  const base = `${publicBaseUrl.replace(/\/+$/, '')}/portal?targa=${encodeURIComponent(plate)}`;
  return token === null || token === '' ? base : `${base}&t=${encodeURIComponent(token)}`;
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
      `Buongiorno ${v.firstName}, le ricordiamo l'appuntamento di oggi alle ${v.scheduledTime} presso Autoclub Group per la vettura ${v.plate}. Il suo codice di accettazione è ${v.code}. Quando è qui ci risponda ARRIVATO; se è in ritardo IN RITARDO, se non può venire ASSENTE.`,
  },
  CHECK_IN_STARTED: {
    spokiTemplateKey: 'check_in_started_v1',
    render: (v) =>
      `Buongiorno ${v.firstName}, la sua vettura ${v.plate} è in accettazione presso Autoclub Group (pratica ${v.code}). Segua lo stato in tempo reale dal suo link personale: ${v.portalUrl}`,
  },
  CHECK_IN_COMPLETED: {
    spokiTemplateKey: 'check_in_completed_v1',
    render: (v) =>
      `Procedura di accettazione completata. Grazie per la visita, puoi proseguire! (Autoclub Group, pratica ${v.code})`,
  },
  ARRIVAL_CONFIRMED: {
    spokiTemplateKey: 'arrival_confirmed_v1',
    render: (v) =>
      `Bentornato ${v.firstName}, la aspettiamo. Il suo codice è ${v.code}: lo vedrà comparire sul monitor dello sportello. Segua il suo turno in tempo reale qui: ${v.portalUrl}`,
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
  portalToken: string | null = null,
): TemplateVars {
  const scheduled = new Date(appointment.scheduledAt);
  // Aziende e clienti senza nome (dati reali di Infinity): il saluto usa la ragione sociale, così
  // il messaggio non esce come "Buongiorno , le ricordiamo…".
  const nome = appointment.customer.firstName.trim();
  return {
    firstName: nome !== '' ? nome : appointment.customer.lastName.trim(),
    lastName: appointment.customer.lastName,
    email: appointment.customer.email ?? '',
    code: appointment.code,
    scheduledTime: localTimeHHmm(scheduled, timeZone),
    scheduledDate: formatBusinessDateIt(toBusinessDate(scheduled, timeZone)),
    plate: appointment.vehicle.plate,
    brandName: brand.name,
    portalUrl: buildPortalUrl(publicBaseUrl, appointment.vehicle.plate, portalToken),
  };
}
