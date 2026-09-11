// Accettazione al veicolo dal tablet (modulo E): foto della carrozzeria, note sui danni rilevati
// e chiusura del check-in.
//
// Le foto passano da `IMediaStorage`: oggi è un mock in memoria, domani il disco dell'officina o
// un archivio cloud, senza che questo caso d'uso cambi. Una foto che non si riesce a salvare non
// deve far perdere il lavoro fatto: l'errore torna al tablet come valore, la pratica resta aperta
// e l'accettatore può riprovare o concludere senza quella foto.
import type { Appointment } from '@/domain/entities/appointment';
import type { MediaAsset } from '@/domain/entities/media-asset';
import { domainError, type DomainError } from '@/domain/errors';
import { asMediaAssetId, type AppointmentId, type OperatorId } from '@/domain/ids';
import { err, ok, type Result } from '@/domain/result';
import type { IAppointmentRepository, IMediaRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { IMediaStorage } from '@/services/interfaces/IMediaStorage';
import type { CrmNotifier } from '../crm/CrmNotifier';
import type { ActionContext, QueueService } from '../queue/QueueService';

export interface InspectionServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly media: IMediaRepository;
  readonly mediaStorage: IMediaStorage;
  readonly queueService: QueueService;
  readonly crmNotifier: CrmNotifier;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

/** Dimensione massima accettata per una foto (le fotocamere dei tablet stanno sotto). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Tipi accettati: solo immagini, perché il video arriverà con il modulo dedicato. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export interface AddPhotoInput {
  readonly appointmentId: AppointmentId;
  readonly operatorId: OperatorId;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly note?: string | null;
}

/** Foto salvata, con l'indirizzo a cui il tablet può rileggerla. */
export interface StoredPhoto {
  readonly asset: MediaAsset;
  readonly url: string;
}

export interface CompleteCheckInInput {
  readonly appointmentId: AppointmentId;
  readonly expectedVersion: number;
  /** Note e danni rilevati durante il giro del veicolo. */
  readonly inspectionNotes: string | null;
}

export interface CheckInResult {
  readonly appointment: Appointment;
  readonly photoCount: number;
  /** True se l'evento è stato accettato dal CRM; false se resta in coda di rinvio. */
  readonly crmNotified: boolean;
}

export class InspectionService {
  private readonly logger: ILogger;

  constructor(private readonly deps: InspectionServiceDeps) {
    this.logger = deps.logger.child('[Ispezione]');
  }

  /** Foto scattata al veicolo: finisce nello storage e nel fascicolo della pratica. */
  async addPhoto(input: AddPhotoInput): Promise<Result<StoredPhoto, DomainError>> {
    if (!ALLOWED_MIME.includes(input.mimeType)) {
      return err(
        domainError('VALIDATION', `Formato immagine non supportato: ${input.mimeType}.`, {
          ammessi: ALLOWED_MIME,
        }),
      );
    }
    if (input.bytes.byteLength === 0) {
      return err(domainError('VALIDATION', 'La foto è vuota.'));
    }
    if (input.bytes.byteLength > MAX_PHOTO_BYTES) {
      return err(
        domainError('VALIDATION', 'Foto troppo grande: riprova con una risoluzione inferiore.', {
          maxBytes: MAX_PHOTO_BYTES,
        }),
      );
    }

    const appointment = await this.deps.appointments.findById(input.appointmentId);
    if (appointment === null) {
      return err(domainError('NOT_FOUND', `Pratica non trovata: ${input.appointmentId}.`));
    }

    const id = this.deps.ids.nextAs(asMediaAssetId);
    const estensione = input.mimeType.split('/')[1] ?? 'jpg';
    const key = `${appointment.businessDate}/${appointment.code}/${id}.${estensione}`;
    const salvata = await this.deps.mediaStorage.put({
      key,
      bytes: input.bytes,
      mimeType: input.mimeType,
    });
    if (!salvata.ok) {
      this.logger.error(`foto non salvata per ${appointment.code}`, {
        errore: salvata.error.message,
      });
      return salvata;
    }

    const asset = await this.deps.media.insert({
      id,
      appointmentId: appointment.id,
      kind: 'PHOTO',
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      storageKey: salvata.value.key,
      thumbnailKey: null,
      capturedByOperatorId: input.operatorId,
      capturedAt: this.deps.clock.nowIso(),
      note: input.note ?? null,
    });
    this.logger.info(`foto acquisita per ${appointment.code}`, {
      mediaId: asset.id,
      sizeBytes: asset.sizeBytes,
    });
    return ok({ asset, url: salvata.value.url });
  }

  /** Foto già acquisite per la pratica, con l'indirizzo di lettura. */
  async listPhotos(appointmentId: AppointmentId): Promise<readonly StoredPhoto[]> {
    const assets = await this.deps.media.listByAppointment(appointmentId);
    return assets.map((asset) => ({ asset, url: this.deps.mediaStorage.getUrl(asset.storageKey) }));
  }

  /**
   * Conclude l'accettazione al veicolo: salva le note, chiude la pratica (la campata si libera e
   * il monitor invita il cliente successivo ad avanzare) e informa il CRM con note e foto.
   * Se la pratica non è in lavorazione la chiusura è rifiutata dalla state machine, come in
   * dashboard: il tablet non è una scorciatoia per saltare i passaggi.
   */
  async completeCheckIn(
    input: CompleteCheckInInput,
    ctx: ActionContext,
  ): Promise<Result<CheckInResult, DomainError>> {
    const corrente = await this.deps.appointments.findById(input.appointmentId);
    if (corrente === null) {
      return err(domainError('NOT_FOUND', `Pratica non trovata: ${input.appointmentId}.`));
    }

    const note = input.inspectionNotes?.trim();
    const noteFinali = note === undefined || note.length === 0 ? corrente.notes : note;

    // Le note vanno salvate prima della chiusura: se il completamento fallisce per un conflitto
    // fra postazioni, il lavoro dell'accettatore al veicolo non è andato perso.
    let versione = input.expectedVersion;
    if (noteFinali !== corrente.notes) {
      const conNote = await this.deps.appointments.update(
        { ...corrente, notes: noteFinali },
        input.expectedVersion,
      );
      if (!conNote.ok) {
        return conNote;
      }
      versione = conNote.value.version;
    }

    const completata = await this.deps.queueService.complete(
      { appointmentId: input.appointmentId, expectedVersion: versione },
      ctx,
    );
    if (!completata.ok) {
      return completata;
    }

    const foto = await this.listPhotos(input.appointmentId);
    const consegna = await this.deps.crmNotifier.notifyCheckIn(
      completata.value,
      {
        inspectionNotes: noteFinali,
        photos: foto.map((f) => ({ url: f.url, capturedAt: f.asset.capturedAt })),
        operatorId: ctx.operatorId,
      },
      ctx.correlationId ?? this.deps.ids.next(),
    );

    this.logger.info(`check-in completato per ${completata.value.code}`, {
      foto: foto.length,
      note: noteFinali !== null,
      crm: consegna.outcome,
    });
    return ok({
      appointment: completata.value,
      photoCount: foto.length,
      crmNotified: consegna.outcome === 'SENT' || consegna.outcome === 'ALREADY_SENT',
    });
  }
}
