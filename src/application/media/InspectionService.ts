// Accettazione al veicolo dal tablet (modulo E): foto e video della carrozzeria, note sui danni
// rilevati e chiusura del check-in.
//
// I media passano da `IMediaStorage`: oggi è un mock in memoria, domani il disco dell'officina o
// un archivio cloud, senza che questo caso d'uso cambi. Un file che non si riesce a salvare non
// deve far perdere il lavoro fatto: l'errore torna al tablet come valore, la pratica resta aperta
// e l'accettatore può riprovare o concludere senza quel media.
//
// Un solo requisito: il VIDEO del veicolo. È la ripresa che al ritiro risponde alla contestazione
// di un graffio, e vale più di quattro foto slegate. Le foto restano facoltative e si aggiungono
// quando servono, con gli slot del giro o con il pulsante "+". Se la fotocamera non funziona la
// pratica si chiude comunque dalla coda in dashboard: l'officina non si ferma per un tablet.
import type { Appointment } from '@/domain/entities/appointment';
import {
  SUGGESTED_PHOTO_CATEGORIES,
  type MediaAsset,
  type MediaCategory,
  type MediaKind,
} from '@/domain/entities/media-asset';
import { domainError, type DomainError } from '@/domain/errors';
import { asMediaAssetId, type AppointmentId, type OperatorId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
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
  /** Giorni di conservazione dei file (env PHOTO_RETENTION_DAYS). */
  readonly retentionDays: number;
}

/** Dimensione massima accettata per una foto (le fotocamere dei tablet stanno sotto). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Dimensione massima di un video: una ripresa breve del giro del veicolo (15-30 secondi con la
 * fotocamera di un iPad) sta sotto, un filmato lungo va rifiutato prima di occupare il disco.
 */
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

/** Immagini accettate dalle fotocamere dei tablet. */
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * Video accettati: mp4 e QuickTime (iPad/iPhone), webm e 3gpp (Android). Il file viene conservato
 * così com'è: nessuna transcodifica, perché il browser che lo rilegge è lo stesso che l'ha girato.
 */
const ALLOWED_VIDEO_MIME = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/3gpp',
];

/** Estensione del file nello storage, dal tipo dichiarato dal tablet. */
const ESTENSIONE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
};

export interface AddMediaInput {
  readonly appointmentId: AppointmentId;
  readonly operatorId: OperatorId;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  /**
   * Parte del veicolo ripresa quando il tablet sta riempiendo uno slot del giro. `null` per i
   * video e per gli scatti liberi: una foto senza slot viene archiviata come aggiuntiva (EXTRA).
   */
  readonly category: MediaCategory | null;
  readonly note?: string | null;
}

/** Ingresso della vecchia firma, quando la categoria era sempre nota (`addPhoto`). */
export interface AddPhotoInput extends Omit<AddMediaInput, 'category'> {
  readonly category: MediaCategory;
}

/** Media salvato, con l'indirizzo a cui il tablet può rileggerlo. */
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
  /** Video acquisiti: contati a parte perché uno solo può sostituire il giro fotografico. */
  readonly videoCount: number;
  /** True se l'evento è stato accettato dal CRM; false se resta in coda di rinvio. */
  readonly crmNotified: boolean;
}

/** Messaggio di rifiuto quando si prova a concludere senza la ripresa del veicolo. */
export const VIDEO_MANCANTE =
  'Manca il video del veicolo: registralo prima di concludere il check-in.';

export class InspectionService {
  private readonly logger: ILogger;

  constructor(private readonly deps: InspectionServiceDeps) {
    this.logger = deps.logger.child('[Ispezione]');
  }

  /**
   * Media acquisito al veicolo (foto di uno slot, scatto libero o video del giro): finisce nello
   * storage e nel fascicolo della pratica. Il tipo lo decide il MIME dichiarato dal tablet, non il
   * chiamante: un video caricato nel campo "foto" resta un video.
   */
  async addMedia(input: AddMediaInput): Promise<Result<StoredPhoto, DomainError>> {
    const kind: MediaKind | null = ALLOWED_IMAGE_MIME.includes(input.mimeType)
      ? 'PHOTO'
      : ALLOWED_VIDEO_MIME.includes(input.mimeType)
        ? 'VIDEO'
        : null;
    if (kind === null) {
      return err(
        domainError('VALIDATION', `Formato non supportato: ${input.mimeType}.`, {
          immagini: ALLOWED_IMAGE_MIME,
          video: ALLOWED_VIDEO_MIME,
        }),
      );
    }
    if (input.bytes.byteLength === 0) {
      return err(
        domainError('VALIDATION', kind === 'VIDEO' ? 'Il video è vuoto.' : 'La foto è vuota.'),
      );
    }
    const maxBytes = kind === 'VIDEO' ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
    if (input.bytes.byteLength > maxBytes) {
      return err(
        domainError(
          'VALIDATION',
          kind === 'VIDEO'
            ? 'Video troppo lungo: registra una ripresa più breve del giro del veicolo.'
            : 'Foto troppo grande: riprova con una risoluzione inferiore.',
          { maxBytes },
        ),
      );
    }

    const appointment = await this.deps.appointments.findById(input.appointmentId);
    if (appointment === null) {
      return err(domainError('NOT_FOUND', `Pratica non trovata: ${input.appointmentId}.`));
    }

    // Un video riprende tutto il giro, quindi non ha una parte del veicolo; una foto senza slot è
    // uno scatto libero e finisce fra le aggiuntive, così nel fascicolo non resta "senza categoria".
    const category: MediaCategory | null = kind === 'VIDEO' ? null : (input.category ?? 'EXTRA');
    const id = this.deps.ids.nextAs(asMediaAssetId);
    const estensione = ESTENSIONE[input.mimeType] ?? input.mimeType.split('/')[1] ?? 'bin';
    const prefisso = category === null ? kind.toLowerCase() : category.toLowerCase();
    const key = `${appointment.businessDate}/${appointment.code}/${prefisso}-${id}.${estensione}`;
    const salvata = await this.deps.mediaStorage.put({
      key,
      bytes: input.bytes,
      mimeType: input.mimeType,
    });
    if (!salvata.ok) {
      this.logger.error(`media non salvato per ${appointment.code}`, {
        errore: salvata.error.message,
        kind,
      });
      return salvata;
    }

    const asset = await this.deps.media.insert({
      id,
      appointmentId: appointment.id,
      kind,
      category,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      storageKey: salvata.value.key,
      thumbnailKey: null,
      capturedByOperatorId: input.operatorId,
      capturedAt: this.deps.clock.nowIso(),
      note: input.note ?? null,
      // La scadenza nasce con il media: la retention non deve ricalcolare nulla, solo confrontare.
      expiresAt: new Date(
        this.deps.clock.now().getTime() + this.deps.retentionDays * 24 * 60 * 60_000,
      ).toISOString() as IsoDateTime,
      archivedAt: null,
    });
    this.logger.info(`media acquisito per ${appointment.code}`, {
      mediaId: asset.id,
      kind,
      categoria: category,
      sizeBytes: asset.sizeBytes,
    });
    return ok({ asset, url: salvata.value.url });
  }

  /** Foto di uno slot del giro: firma storica, oggi un caso particolare di `addMedia`. */
  async addPhoto(input: AddPhotoInput): Promise<Result<StoredPhoto, DomainError>> {
    return this.addMedia(input);
  }

  /** Foto e video già acquisiti per la pratica, con l'indirizzo di lettura. */
  async listPhotos(appointmentId: AppointmentId): Promise<readonly StoredPhoto[]> {
    const assets = await this.deps.media.listByAppointment(appointmentId);
    return assets.map((asset) => ({ asset, url: this.deps.mediaStorage.getUrl(asset.storageKey) }));
  }

  /**
   * Riprese del giro consigliato non ancora scattate. Serve al tablet e al fascicolo come
   * promemoria: dal refactoring dei media NON blocca più la chiusura del check-in, perché con il
   * cliente davanti una pratica che non si chiude costa più di una foto che manca.
   */
  async missingSuggestedCategories(
    appointmentId: AppointmentId,
  ): Promise<readonly MediaCategory[]> {
    const assets = await this.deps.media.listByAppointment(appointmentId);
    const presenti = new Set(assets.map((a) => a.category));
    return SUGGESTED_PHOTO_CATEGORIES.filter((c) => !presenti.has(c));
  }

  /**
   * Conclude l'accettazione al veicolo: salva le note, chiude la pratica (lo sportello si libera e
   * il monitor invita il cliente successivo ad avanzare) e informa il CRM con note, foto e video.
   * Se la pratica non è in lavorazione la chiusura è rifiutata dalla state machine, come in
   * dashboard: il tablet non è una scorciatoia per saltare i passaggi.
   *
   * Il VIDEO del veicolo è obbligatorio: è la ripresa che al ritiro racconta com'era la vettura
   * all'arrivo, e senza di quella la contestazione di un graffio non ha risposta. Le foto restano
   * facoltative, perché il video le contiene già. Il controllo vive qui e non solo nella UI: una
   * seconda scheda aperta o una chiamata diretta all'API non devono poterlo saltare.
   *
   * Non è un blocco per l'officina: se la fotocamera non funziona, la pratica si chiude lo stesso
   * dalla coda in dashboard ("Completato"), che resta la via manuale di sempre.
   */
  async completeCheckIn(
    input: CompleteCheckInInput,
    ctx: ActionContext,
  ): Promise<Result<CheckInResult, DomainError>> {
    const corrente = await this.deps.appointments.findById(input.appointmentId);
    if (corrente === null) {
      return err(domainError('NOT_FOUND', `Pratica non trovata: ${input.appointmentId}.`));
    }

    const acquisiti = await this.listPhotos(input.appointmentId);
    if (!acquisiti.some((m) => m.asset.kind === 'VIDEO')) {
      this.logger.warn(`check-in senza video per ${corrente.code}`, {
        appointmentId: corrente.id,
        operatorId: ctx.operatorId,
      });
      return err(domainError('VALIDATION', VIDEO_MANCANTE, { videoMancante: true }));
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

    // Rilettura dopo la chiusura: fra l'inizio del metodo e adesso il tablet può aver caricato
    // l'ultimo scatto, e il CRM deve ricevere il fascicolo completo.
    const media = await this.listPhotos(input.appointmentId);
    const consegna = await this.deps.crmNotifier.notifyCheckIn(
      completata.value,
      {
        inspectionNotes: noteFinali,
        photos: media.map((f) => ({
          url: f.url,
          capturedAt: f.asset.capturedAt,
          category: f.asset.category,
        })),
        operatorId: ctx.operatorId,
      },
      ctx.correlationId ?? this.deps.ids.next(),
    );

    const video = media.filter((m) => m.asset.kind === 'VIDEO').length;
    this.logger.info(`check-in completato per ${completata.value.code}`, {
      foto: media.length - video,
      video,
      note: noteFinali !== null,
      crm: consegna.outcome,
    });
    return ok({
      appointment: completata.value,
      photoCount: media.length - video,
      videoCount: video,
      crmNotified: consegna.outcome === 'SENT' || consegna.outcome === 'ALREADY_SENT',
    });
  }
  /**
   * Conferma di una chiusura d'ufficio (pratica ancora in carico alle 19:00, completata dal
   * sistema): il responsabile dichiara che il veicolo era stato accettato davvero. Il flag si
   * spegne e il CRM riceve il check-in con i media e le note che c'erano.
   */
  async confirmAutoClosed(
    input: { readonly appointmentId: AppointmentId; readonly expectedVersion: number },
    ctx: ActionContext,
  ): Promise<Result<CheckInResult, DomainError>> {
    const confermata = await this.deps.queueService.confirmAutoClose(input, ctx);
    if (!confermata.ok) {
      return confermata;
    }
    const media = await this.listPhotos(input.appointmentId);
    const consegna = await this.deps.crmNotifier.notifyCheckIn(
      confermata.value,
      {
        inspectionNotes: confermata.value.notes,
        photos: media.map((f) => ({
          url: f.url,
          capturedAt: f.asset.capturedAt,
          category: f.asset.category,
        })),
        operatorId: ctx.operatorId,
      },
      ctx.correlationId ?? this.deps.ids.next(),
    );
    const video = media.filter((m) => m.asset.kind === 'VIDEO').length;
    return ok({
      appointment: confermata.value,
      photoCount: media.length - video,
      videoCount: video,
      crmNotified: consegna.outcome === 'SENT' || consegna.outcome === 'ALREADY_SENT',
    });
  }
}
