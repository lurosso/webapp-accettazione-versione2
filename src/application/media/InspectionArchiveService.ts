// Archivio delle ispezioni fotografiche e retention dei file (modulo E).
//
// Le foto sono materiale della pratica, non un archivio storico: servono nelle settimane in cui
// un cliente può contestare un danno, poi occupano solo il disco dell'officina. Per questo ogni
// foto nasce con una scadenza (`expiresAt`) e, passata quella, il file sparisce dal disco mentre il
// RECORD resta, marcato `archivedAt`: nel fascicolo si continua a leggere che quel giorno erano
// state scattate quattro foto del giro veicolo, anche se le immagini non ci sono più. Cancellare
// subito anche il record cancellerebbe la prova che il giro era stato fatto.
// Il record però non resta per sempre: trascorsi `hardDeleteDays` dall'archiviazione viene
// eliminato anche lui (secondo passaggio dello stesso job), altrimenti il database accumulerebbe
// righe che nessuno consulterà più.
import { PHOTO_CATEGORY_LABELS } from '@/domain/entities/media-asset';
import type { MediaAsset } from '@/domain/entities/media-asset';
import { customerFullName } from '@/domain/entities/customer';
import type {
  Appointment,
  AppointmentFlow,
  AppointmentStatus,
} from '@/domain/entities/appointment';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { normalizePlate } from '@/domain/value-objects/plate';
import type {
  IAppointmentRepository,
  IMediaRepository,
  IReferenceDataRepository,
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { IMediaStorage } from '@/services/interfaces/IMediaStorage';

export interface InspectionArchiveServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly media: IMediaRepository;
  readonly mediaStorage: IMediaStorage;
  readonly referenceData: IReferenceDataRepository;
  readonly clock: IClock;
  readonly logger: ILogger;
  /** Giorni dopo l'archiviazione oltre i quali il record viene eliminato (PHOTO_HARD_DELETE_DAYS). */
  readonly hardDeleteDays: number;
}

const GIORNO_MS = 24 * 60 * 60_000;

export interface ArchivedPhotoView {
  readonly id: string;
  /** Foto o video: decide se l'archivio mostra una miniatura o un lettore. */
  readonly kind: 'PHOTO' | 'VIDEO';
  readonly category: string | null;
  readonly categoryLabel: string;
  /** Indirizzo di lettura; null quando il file è stato eliminato dalla retention. */
  readonly url: string | null;
  readonly capturedAt: IsoDateTime;
  readonly sizeBytes: number;
  readonly expiresAt: IsoDateTime;
  readonly archivedAt: IsoDateTime | null;
}

export interface InspectionArchiveEntry {
  readonly appointmentId: string;
  readonly code: string;
  readonly businessDate: string;
  /** Orario atteso dell'ingresso (o della riconsegna). */
  readonly scheduledAt: IsoDateTime;
  readonly plate: string;
  readonly vehicle: string;
  readonly customerName: string;
  readonly status: AppointmentStatus;
  /** Accettazione in entrata o riconsegna del veicolo. */
  readonly flow: AppointmentFlow;
  readonly completedAt: IsoDateTime | null;
  /** Lavorazioni richieste (o stato della commessa per una riconsegna). */
  readonly serviceDescription: string | null;
  /** Ordine di lavoro / commessa in Infinity, se aperto. */
  readonly workOrderRef: string | null;
  readonly notes: string | null;
  readonly photos: readonly ArchivedPhotoView[];
  /** True quando c'erano foto e tutti i file sono stati eliminati: restano i metadati. */
  readonly archived: boolean;
}

export interface RetentionSummary {
  /** Foto con file scaduto trovate in questo giro. */
  readonly examined: number;
  /** File eliminati (o già assenti) e record marcati come archiviati. */
  readonly archived: number;
  /** File che non si è riusciti a eliminare: si riprova al giro successivo. */
  readonly failed: number;
  /** Record archiviati da oltre `hardDeleteDays` eliminati definitivamente. */
  readonly deleted: number;
}

export class InspectionArchiveService {
  private readonly logger: ILogger;

  constructor(private readonly deps: InspectionArchiveServiceDeps) {
    this.logger = deps.logger.child('[Archivio]');
  }

  /**
   * Senza ricerca: gli ultimi check-in fotografici, dal più recente. Con una ricerca per targa
   * (normalizzata: spazi e minuscole non contano) o per codice pratica: la STORIA del veicolo, cioè
   * ogni ingresso in officina su tutte le giornate e i flussi, uno per riga dal più recente, con o
   * senza foto. Prima si vedeva solo chi aveva foto, e una targa entrata più volte sembrava una sola
   * pratica: il ritiro contestato di un veicolo abituale ha bisogno di tutta la sua storia.
   */
  async search(query: string, limit = 50): Promise<readonly InspectionArchiveEntry[]> {
    const tutte = await this.deps.media.listAll();
    const perPratica = new Map<string, MediaAsset[]>();
    for (const asset of tutte) {
      const gruppo = perPratica.get(asset.appointmentId) ?? [];
      gruppo.push(asset);
      perPratica.set(asset.appointmentId, gruppo);
    }
    const brands = await this.deps.referenceData.listBrands();
    const testo = query.trim();

    const pratiche: Appointment[] = [];
    if (testo === '') {
      for (const appointmentId of perPratica.keys()) {
        const a = await this.deps.appointments.findById(
          appointmentId as MediaAsset['appointmentId'],
        );
        if (a !== null) {
          pratiche.push(a);
        }
      }
    } else {
      pratiche.push(
        ...(await this.deps.appointments.searchHistory(
          { plate: normalizePlate(testo), code: testo.toUpperCase() },
          limit,
        )),
      );
    }

    const voci = pratiche.map((a): InspectionArchiveEntry => {
      const foto = [...(perPratica.get(a.id) ?? [])].sort((x, y) =>
        x.capturedAt.localeCompare(y.capturedAt),
      );
      return {
        appointmentId: a.id,
        code: a.code,
        businessDate: a.businessDate,
        scheduledAt: a.scheduledAt,
        plate: a.vehicle.plate,
        vehicle:
          `${brands.find((b) => b.id === a.vehicle.brandId)?.name ?? ''} ${a.vehicle.model}`.trim(),
        customerName: customerFullName(a.customer),
        status: a.status,
        flow: a.flow,
        completedAt: a.completedAt,
        serviceDescription: a.serviceDescription,
        workOrderRef: a.workOrderRef,
        notes: a.notes,
        photos: foto.map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          category: asset.category,
          categoryLabel:
            asset.kind === 'VIDEO'
              ? 'Video del veicolo'
              : asset.category === null
                ? 'Senza categoria'
                : PHOTO_CATEGORY_LABELS[asset.category],
          url: asset.archivedAt === null ? this.deps.mediaStorage.getUrl(asset.storageKey) : null,
          capturedAt: asset.capturedAt,
          sizeBytes: asset.sizeBytes,
          expiresAt: asset.expiresAt,
          archivedAt: asset.archivedAt,
        })),
        archived: foto.length > 0 && foto.every((asset) => asset.archivedAt !== null),
      };
    });

    // Cronologico inverso: giornata, poi orario, poi codice.
    return voci
      .sort(
        (x, y) =>
          y.businessDate.localeCompare(x.businessDate) ||
          y.scheduledAt.localeCompare(x.scheduledAt) ||
          y.code.localeCompare(x.code),
      )
      .slice(0, limit);
  }

  /**
   * Retention in due passaggi.
   * 1) File: elimina dal disco le foto scadute e marca i record come archiviati. Un file già
   *    sparito (NOT_FOUND) conta come archiviato: l'obiettivo è che non occupi spazio, non che
   *    l'eliminazione sia "nostra". Un errore su un file non ferma gli altri.
   * 2) Record: i metadati archiviati da oltre `hardDeleteDays` vengono eliminati definitivamente.
   *    Il conteggio parte dall'archiviazione, non dallo scatto: se il primo passaggio è rimasto
   *    fermo per giorni, la scheda resta comunque leggibile per tutto il periodo promesso.
   */
  async purgeExpired(): Promise<RetentionSummary> {
    const now = this.deps.clock.nowIso();
    const scadute = await this.deps.media.listExpired(now);
    let archived = 0;
    let failed = 0;
    for (const asset of scadute) {
      const eliminato = await this.deps.mediaStorage.delete(asset.storageKey);
      if (!eliminato.ok && eliminato.error.code !== 'NOT_FOUND') {
        failed += 1;
        this.logger.warn(`retention: file non eliminato ${asset.storageKey}`, {
          errore: eliminato.error.message,
        });
        continue;
      }
      await this.deps.media.update({ ...asset, archivedAt: now });
      archived += 1;
    }

    const deleted = await this.hardDeleteArchived(now);

    if (scadute.length > 0 || deleted > 0) {
      this.logger.info('retention foto completata', {
        esaminate: scadute.length,
        archived,
        failed,
        deleted,
      });
    }
    return { examined: scadute.length, archived, failed, deleted };
  }

  /** Secondo passaggio: elimina i record archiviati da più di `hardDeleteDays`. */
  private async hardDeleteArchived(now: IsoDateTime): Promise<number> {
    const cutoff = new Date(
      new Date(now).getTime() - this.deps.hardDeleteDays * GIORNO_MS,
    ).toISOString() as IsoDateTime;
    const daEliminare = await this.deps.media.listArchivedBefore(cutoff);
    for (const asset of daEliminare) {
      await this.deps.media.delete(asset.id);
    }
    return daEliminare.length;
  }
}
