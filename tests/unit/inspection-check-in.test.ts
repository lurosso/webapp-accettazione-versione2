import { describe, expect, it } from 'vitest';
import { InspectionService, MAX_PHOTO_BYTES } from '@/application/media/InspectionService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import type { CrmCheckInPayloadDto } from '@/services/dto/crm.dto';
import { REQUIRED_PHOTO_CATEGORIES, type MediaCategory } from '@/domain/entities/media-asset';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const queueService = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    notifications: env.notifications,
    crmNotifier: env.crmNotifier,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
  });
  const inspection = new InspectionService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: env.mediaStorage,
    queueService,
    crmNotifier: env.crmNotifier,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-tablet',
  };
  return { env, queueService, inspection, ctx };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

/** Finto contenuto di una foto: al mock interessano dimensione e tipo, non i pixel. */
const fotoFinta = (bytes = 2048): Uint8Array => new Uint8Array(bytes).fill(7);

/** Scatta il giro completo delle quattro riprese obbligatorie. */
async function giroCompleto(
  inspection: InspectionService,
  appointmentId: Appointment['id'],
  operatorId: ActionContext['operatorId'],
): Promise<void> {
  for (const category of REQUIRED_PHOTO_CATEGORIES) {
    const r = await inspection.addPhoto({
      appointmentId,
      operatorId,
      bytes: fotoFinta(),
      mimeType: 'image/jpeg',
      category,
    });
    if (!r.ok) {
      throw new Error(r.error.message);
    }
  }
}

describe('InspectionService: foto del veicolo', () => {
  it('salva la foto nello storage e la registra sulla pratica', async () => {
    const { env, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());

    const r = await inspection.addPhoto({
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      bytes: fotoFinta(),
      mimeType: 'image/jpeg',
      category: 'FRONT',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.asset.kind).toBe('PHOTO');
      expect(r.value.asset.category).toBe('FRONT');
      // La chiave dice a colpo d'occhio quale parte del veicolo è stata ripresa.
      expect(r.value.asset.storageKey).toContain('front-');
      expect(r.value.asset.sizeBytes).toBe(2048);
      // La chiave contiene giornata e codice: i file restano riconoscibili nell'archivio.
      expect(r.value.asset.storageKey).toContain(a.code);
      expect(r.value.url).toContain('/api/v1/media/');
      expect(env.mediaStorage.get(r.value.asset.storageKey)).not.toBeNull();
    }

    const elenco = await inspection.listPhotos(a.id);
    expect(elenco).toHaveLength(1);
  });

  it('rifiuta formati non immagine, foto vuote e foto troppo grandi', async () => {
    const { env, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());
    const base = {
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      category: 'FRONT' as MediaCategory,
    };

    const pdf = await inspection.addPhoto({
      ...base,
      bytes: fotoFinta(),
      mimeType: 'application/pdf',
    });
    expect(pdf.ok).toBe(false);

    const vuota = await inspection.addPhoto({
      ...base,
      bytes: new Uint8Array(0),
      mimeType: 'image/jpeg',
    });
    expect(vuota.ok).toBe(false);

    const enorme = await inspection.addPhoto({
      ...base,
      bytes: new Uint8Array(MAX_PHOTO_BYTES + 1),
      mimeType: 'image/jpeg',
    });
    expect(enorme.ok).toBe(false);
    if (!enorme.ok) {
      expect(enorme.error.code).toBe('VALIDATION');
    }
    expect(env.mediaStorage.size).toBe(0);
  });

  it('una pratica inesistente non accetta foto', async () => {
    const { inspection, ctx } = setup();
    const r = await inspection.addPhoto({
      appointmentId: makeAppointment().id,
      operatorId: ctx.operatorId,
      bytes: fotoFinta(),
      mimeType: 'image/jpeg',
      category: 'FRONT',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('InspectionService: chiusura del check-in', () => {
  it('salva le note, chiude la pratica e informa il CRM con note e foto', async () => {
    const { env, queueService, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    await giroCompleto(inspection, a.id, ctx.operatorId);

    const r = await inspection.completeCheckIn(
      {
        appointmentId: a.id,
        expectedVersion: 2,
        inspectionNotes: 'Graffio sul paraurti posteriore destro.',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.appointment.status).toBe('COMPLETED');
    expect(r.value.appointment.notes).toContain('paraurti');
    expect(r.value.photoCount).toBe(4);
    expect(r.value.crmNotified).toBe(true);

    const ricevuto = env.crm.received.at(-1) as CrmCheckInPayloadDto;
    expect(ricevuto.code).toBe(a.code);
    expect(ricevuto.inspectionNotes).toContain('paraurti');
    expect(ricevuto.photos).toHaveLength(4);
    expect(ricevuto.photos.map((f) => f.category)).toEqual(['FRONT', 'REAR', 'LEFT', 'RIGHT']);

    // L'evento resta tracciato nella coda di uscita come inviato.
    const inviati = await env.crmOutbox.listByStatus(['SENT']);
    expect(inviati.filter((e) => e.type === 'CHECK_IN')).toHaveLength(1);
  });

  it('senza le quattro foto obbligatorie il check-in non si chiude', async () => {
    const { env, queueService, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    // Solo frontale e posteriore: il giro del veicolo è a metà.
    for (const category of ['FRONT', 'REAR'] as const) {
      await inspection.addPhoto({
        appointmentId: a.id,
        operatorId: ctx.operatorId,
        bytes: fotoFinta(),
        mimeType: 'image/jpeg',
        category,
      });
    }

    const r = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 2, inspectionNotes: 'Nota del giro a metà' },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('VALIDATION');
      expect(r.error.message).toContain('Fiancata sinistra');
      expect(r.error.details?.['mancanti']).toEqual(['LEFT', 'RIGHT']);
    }

    // La pratica resta in lavorazione e il CRM non riceve nulla: niente accettazione a metà.
    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.status).toBe('IN_PROGRESS');
    expect(env.crm.received).toHaveLength(0);
  });

  it('le foto facoltative non sbloccano da sole la chiusura', async () => {
    const { env, queueService, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    for (const category of ['INTERIOR', 'DAMAGE'] as const) {
      await inspection.addPhoto({
        appointmentId: a.id,
        operatorId: ctx.operatorId,
        bytes: fotoFinta(),
        mimeType: 'image/jpeg',
        category,
      });
    }

    expect(await inspection.missingRequiredCategories(a.id)).toEqual([
      'FRONT',
      'REAR',
      'LEFT',
      'RIGHT',
    ]);
    const r = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 2, inspectionNotes: null },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it('completato il giro non manca più nulla e la chiusura passa', async () => {
    const { env, queueService, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    await giroCompleto(inspection, a.id, ctx.operatorId);

    expect(await inspection.missingRequiredCategories(a.id)).toEqual([]);
    const r = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 2, inspectionNotes: null },
      ctx,
    );
    expect(r.ok && r.value.appointment.status).toBe('COMPLETED');
  });

  it('una pratica non in lavorazione non può essere chiusa dal tablet', async () => {
    const { env, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await giroCompleto(inspection, a.id, ctx.operatorId);

    const r = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 1, inspectionNotes: null },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_TRANSITION');
    }
    expect(env.crm.received).toHaveLength(0);
  });

  it('con versione obsoleta il check-in è rifiutato e le note non vengono perse', async () => {
    const { env, queueService, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    await giroCompleto(inspection, a.id, ctx.operatorId);

    const r = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 1, inspectionNotes: 'Nota scritta al veicolo' },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('VERSION_CONFLICT');
    }
    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.status).toBe('IN_PROGRESS');
  });

  it('un CRM guasto non impedisce di chiudere: l’evento resta in coda di rinvio', async () => {
    const env = buildTestEnv();
    // Ambiente con CRM in errore: si riusa il costruttore delle fixture cambiando solo il mock.
    const { CrmServiceMock } = await import('@/services/mocks/CrmServiceMock');
    const { CrmNotifier } = await import('@/application/crm/CrmNotifier');
    const crmGuasto = new CrmServiceMock(
      { mode: 'error', latencyMs: 0 },
      { clock: env.clock, logger: env.logger },
    );
    const notifier = new CrmNotifier({
      crm: crmGuasto,
      outbox: env.crmOutbox,
      referenceData: env.referenceData,
      clock: env.clock,
      ids: env.ids,
      logger: env.logger,
    });
    const queueService = new QueueService({
      appointments: env.appointments,
      referenceData: env.referenceData,
      operators: env.operators,
      notifications: env.notifications,
      crmNotifier: notifier,
      eventBus: env.eventBus,
      clock: env.clock,
      ids: env.ids,
      logger: env.logger,
    });
    const inspection = new InspectionService({
      appointments: env.appointments,
      media: env.media,
      mediaStorage: env.mediaStorage,
      queueService,
      crmNotifier: notifier,
      clock: env.clock,
      ids: env.ids,
      logger: env.logger,
    });
    const ctx: ActionContext = {
      operatorId: asOperatorId('op-advisor-1'),
      workstationId: asWorkstationId('ws-p1'),
      correlationId: 'corr-crm-giu',
    };

    const a = await insert(env, makeAppointment());
    await queueService.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    await giroCompleto(inspection, a.id, ctx.operatorId);
    const r = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 2, inspectionNotes: 'Tutto in ordine' },
      ctx,
    );

    // L'accettazione si chiude comunque: l'officina non si ferma per il CRM.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.appointment.status).toBe('COMPLETED');
      expect(r.value.crmNotified).toBe(false);
    }
    // Il finto CRM rifiuta con un errore definitivo: l'evento resta tracciato come non riuscito e
    // la riprova diventa una decisione del tecnico (pannello Sistema), non un ciclo infinito.
    const inCoda = await env.crmOutbox.listByStatus(['PENDING', 'FAILED']);
    const evento = inCoda.find((e) => e.type === 'CHECK_IN');
    expect(evento).toBeDefined();
    expect(evento?.status).toBe('FAILED');
    expect(evento?.attemptCount).toBe(1);
    expect(evento?.lastError).toContain('PROVIDER_ERROR');
  });
});
