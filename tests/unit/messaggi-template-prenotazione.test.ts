// I dati che i template 📅 chiedono e che l'app prepara (M8-T53-S02): nome del cliente, marca e
// modello, riconsegna prevista, sede, e il nome dell'accettatore — chi ha preso in carico la
// pratica, altrimenti quello assegnato in Infinity reso leggibile.
import { describe, expect, it } from 'vitest';
import { NotificationOrchestrator } from '@/application/notifications/NotificationOrchestrator';
import { buildTemplateVars, readableName } from '@/application/notifications/templates';
import { asOperatorId } from '@/domain/ids';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';

describe('Nomi leggibili', () => {
  it('il maiuscolo del gestionale diventa «Nome Cognome»; un nome già scritto bene resta', () => {
    expect(readableName('MARIO ROSSI')).toBe('Mario Rossi');
    expect(readableName("  GIANNI  D'ANGELO ")).toBe("Gianni D'Angelo");
    expect(readableName('ANNA-MARIA NERI')).toBe('Anna-Maria Neri');
    expect(readableName('Laura Bianchi')).toBe('Laura Bianchi');
    expect(readableName('')).toBe('');
  });
});

describe('Variabili dei template 📅', () => {
  it('nome completo, marca e modello, riconsegna prevista e sede', () => {
    const a = makeAppointment({
      expectedDelivery: { date: '2026-09-12' as IsoDate, time: '12:30' },
    });
    const v = buildTemplateVars(
      a,
      { id: a.brandId, name: 'Fiat' } as never,
      'Europe/Rome',
      '',
      null,
      60,
      { site: 'Autoclub', advisorName: '  Laura Bianchi ' },
    );
    expect(v.customerName).toBe(`${a.customer.firstName} ${a.customer.lastName}`);
    expect(v.vehicleLabel).toBe(`Fiat ${a.vehicle.model}`);
    expect(v.expectedDeliveryDate).toBe('12/09/2026');
    expect(v.expectedDeliveryTime).toBe('12:30');
    expect(v.site).toBe('Autoclub');
    expect(v.advisorName).toBe('Laura Bianchi');
  });

  it('senza riconsegna, sede o modello i campi restano vuoti (e il template non partirà)', () => {
    const a = makeAppointment({
      vehicle: { ...makeAppointment().vehicle, model: 'n/d' },
      customer: { ...makeAppointment().customer, firstName: '', lastName: 'Officine Rossi Srl' },
    });
    const v = buildTemplateVars(a, { id: a.brandId, name: 'Jeep' } as never);
    expect(v.customerName).toBe('Officine Rossi Srl');
    expect(v.vehicleLabel).toBe('Jeep');
    expect(v.expectedDeliveryDate).toBe('');
    expect(v.expectedDeliveryTime).toBe('');
    expect(v.site).toBe('');
    expect(v.advisorName).toBe('');
  });
});

describe('Il nome dell’accettatore nella 📅 Conferma Accettazione', () => {
  function orchestratore(env: ReturnType<typeof buildTestEnv>) {
    return new NotificationOrchestrator({
      spoki: env.spoki,
      smsHosting: env.smsHosting,
      notifications: env.notifications,
      clock: env.clock,
      ids: env.ids,
      logger: env.logger,
      eventBus: env.eventBus,
      timeZone: 'Europe/Rome',
      siteName: 'Autoclub',
      operators: env.operators,
    });
  }

  it('è chi ha preso in carico la pratica; senza, quello assegnato in Infinity, leggibile', async () => {
    const env = buildTestEnv();
    const o = orchestratore(env);
    const brand = env.seed.brands[0]!;
    const inCarico = makeAppointment({
      status: 'IN_PROGRESS',
      operatorId: asOperatorId('op-advisor-1'),
      assignedAdvisor: { code: '103', name: 'SILVIA NERI' },
    });
    const soloInfinity = makeAppointment({
      status: 'IN_PROGRESS',
      operatorId: null,
      assignedAdvisor: { code: '103', name: 'SILVIA NERI' },
    });
    const r1 = await o.sendReminder({
      appointment: inCarico,
      brand,
      kind: 'CHECK_IN_STARTED',
      correlationId: 'c1',
    });
    const r2 = await o.sendReminder({
      appointment: soloInfinity,
      brand,
      kind: 'CHECK_IN_STARTED',
      correlationId: 'c2',
    });
    expect(r1.job.templateVariables['advisorName']).toBe('Mario Rossi');
    expect(r2.job.templateVariables['advisorName']).toBe('Silvia Neri');
    expect(r1.job.templateVariables['site']).toBe('Autoclub');
  });
});
