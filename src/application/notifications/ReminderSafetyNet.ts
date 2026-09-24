// Rete di sicurezza del promemoria del mattino (M8-T51-S08).
//
// Il promemoria del giorno stesso lo manda l'app all'ora REMINDER_SAME_DAY_HOUR_LOCAL. Se a
// quell'ora il server è giù, lo manda Spoki: un'automazione con trigger sulla data del campo
// `ACC_GIORNO` parte alle SPOKI_SAFETY_NET_TIME per ogni contatto con l'appuntamento oggi, e manda
// il promemoria solo a chi ha ancora `ACC_PROMEMORIA = DA_INVIARE` (docs/SPOKI.md). Il campo lo
// scrive l'app a ogni invio: `DA_INVIARE` il promemoria del giorno prima, `INVIATO` qualunque
// messaggio del giorno stesso.
//
// Questo servizio fa le due cose che servono perché la rete non raddoppi e non scriva a chi non
// deve:
// - `disarm`: dopo il promemoria del giorno, scrive `NON_SERVE` sui contatti che hanno avuto il
//   promemoria del giorno prima su WhatsApp ma non quello di oggi (pratica annullata, già arrivata,
//   in carico, oppure promemoria di oggi finito sull'SMS);
// - `handedOver`: dall'ora della rete in poi l'app non manda più il promemoria del giorno (se ne sta
//   occupando Spoki), anche quando lo scheduler si rimette in pari dopo un riavvio.
//
// Mai bloccante: un guasto verso Spoki si scrive nel log e il giro del promemoria resta valido.
import type { Appointment } from '@/domain/entities/appointment';
import type { NotificationJob } from '@/domain/entities/notification';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { localTimeHHmm, toBusinessDate } from '@/lib/dates';
import type { IAppointmentRepository } from '@/repositories/interfaces';
import type { INotificationRepository } from '@/repositories/interfaces/INotificationRepository';
import { SPOKI_REMINDER_STATE_FIELD } from '@/services/dto/spoki.dto';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { ISpokiService } from '@/services/interfaces/ISpokiService';

export interface ReminderSafetyNetDeps {
  readonly appointments: IAppointmentRepository;
  readonly notifications: INotificationRepository;
  readonly spoki: ISpokiService;
  readonly clock: IClock;
  readonly logger: ILogger;
  /** SPOKI_SAFETY_NET_TIME, ora locale "HH:mm" della rete in Spoki; null = rete spenta. */
  readonly time: string | null;
  readonly timeZone: string;
}

/** Com'è andato il disarmo di una giornata. */
export interface SafetyNetDisarmSummary {
  /** Pratiche con il promemoria del giorno prima su WhatsApp e senza quello di oggi. */
  readonly candidates: number;
  readonly disarmed: number;
  readonly failed: number;
}

const INVIATO_SU_WHATSAPP: readonly NotificationJob['status'][] = ['SENT', 'DELIVERED', 'READ'];

/** Il messaggio `kind` è arrivato al cliente su WhatsApp (non sull'SMS, non fallito). */
function suWhatsApp(jobs: readonly NotificationJob[], kind: NotificationJob['kind']): boolean {
  return jobs.some(
    (j) =>
      j.kind === kind && j.currentChannel === 'WHATSAPP' && INVIATO_SU_WHATSAPP.includes(j.status),
  );
}

export class ReminderSafetyNet {
  private readonly logger: ILogger;

  constructor(private readonly deps: ReminderSafetyNetDeps) {
    this.logger = deps.logger.child('[ReteSicurezza]');
  }

  /** True se la rete di sicurezza in Spoki è configurata. */
  get enabled(): boolean {
    return this.deps.time !== null;
  }

  /** Ora locale della rete ("HH:mm"), null se spenta. */
  get time(): string | null {
    return this.deps.time;
  }

  /**
   * True quando, per la giornata indicata, il promemoria del giorno è ormai affidato a Spoki: è oggi
   * e l'ora locale ha raggiunto quella della rete.
   */
  handedOver(businessDate: IsoDate): boolean {
    const ora = this.deps.time;
    if (ora === null) {
      return false;
    }
    const adesso = this.deps.clock.now();
    return (
      toBusinessDate(adesso, this.deps.timeZone) === businessDate &&
      localTimeHHmm(adesso, this.deps.timeZone) >= ora
    );
  }

  /**
   * Scrive `ACC_PROMEMORIA = NON_SERVE` su chi non deve ricevere il promemoria dalla rete: il
   * contatto ha avuto il promemoria del giorno prima su WhatsApp (quindi vale `DA_INVIARE`) ma non
   * quello di oggi. Con la rete spenta non fa niente.
   */
  async disarm(businessDate: IsoDate, correlationId: string): Promise<SafetyNetDisarmSummary> {
    if (!this.enabled) {
      return { candidates: 0, disarmed: 0, failed: 0 };
    }
    // Le annullate sono proprio quelle da disarmare: senza `includeCancelled` non ci sarebbero.
    const giornata = await this.deps.appointments.listByDate(businessDate, {
      includeCancelled: true,
    });
    const daDisarmare: Appointment[] = [];
    for (const a of giornata) {
      if (a.customer.phone === null) {
        continue;
      }
      const jobs = await this.deps.notifications.listByAppointment(a.id);
      if (suWhatsApp(jobs, 'REMINDER_PREVIOUS_DAY') && !suWhatsApp(jobs, 'REMINDER_SAME_DAY')) {
        daDisarmare.push(a);
      }
    }
    let disarmed = 0;
    let failed = 0;
    for (const a of daDisarmare) {
      if (a.customer.phone === null) {
        continue;
      }
      try {
        const esito = await this.deps.spoki.updateContactFields({
          to: a.customer.phone,
          fields: { [SPOKI_REMINDER_STATE_FIELD]: 'NON_SERVE' },
          correlationId,
        });
        if (esito.ok) {
          disarmed += 1;
        } else {
          failed += 1;
          this.logger.warn(`pratica ${a.code}: rete di sicurezza non disarmata`, {
            appointmentId: a.id,
            code: esito.error.code,
            message: esito.error.message,
          });
        }
      } catch (cause) {
        failed += 1;
        this.logger.warn(`pratica ${a.code}: rete di sicurezza non disarmata`, {
          appointmentId: a.id,
          errore: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    if (daDisarmare.length > 0) {
      this.logger.info(
        `${businessDate}: rete di sicurezza disarmata per ${disarmed} contatti su ${daDisarmare.length}`,
        { failed, correlationId },
      );
    }
    return { candidates: daDisarmare.length, disarmed, failed };
  }
}
