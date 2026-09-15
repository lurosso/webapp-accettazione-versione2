// Verifica di integrazione con il database Infinity REALE via ODBC (sola lettura).
//
// Gira solo quando è impostata INFINITY_ODBC_DSN (es. `npm run infinity:check` con
// `INFINITY_ODBC_DSN=Infinity02` nell'ambiente): senza, la suite è saltata e la CI resta verde.
// Stampa a terminale il planning della giornata `INFINITY_ODBC_DATE` (default: oggi) con i campi
// essenziali (targa, cliente, data, ora, tipo documento, note, accettatore, lavorazioni), i
// telefoni mascherati. Nessuna scrittura sul database: solo SELECT.
import { describe, expect, it } from 'vitest';
import { resolveInfinityRealConfig } from '@/config/infinity';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { isIsoDate, isoDateTime } from '@/domain/value-objects/iso-date';
import type { IClock } from '@/services/interfaces/IClock';
import { ConsoleLogger } from '@/services/mocks/ConsoleLogger';
import {
  InfinityServiceOdbc,
  SqlAnywhereOdbcClient,
  buildConnectionString,
  describeConnection,
  type InfinityAccessCheck,
  type InfinityPlanningRecord,
} from '@/infrastructure/adapters/infinity';
import { toBusinessDate } from '@/lib/dates';

const DSN = process.env['INFINITY_ODBC_DSN']?.trim() ?? '';
const GIORNATA_RAW = process.env['INFINITY_ODBC_DATE']?.trim() ?? '';

class RealClock implements IClock {
  now(): Date {
    return new Date();
  }
  nowIso() {
    return isoDateTime(new Date());
  }
  today(): IsoDate {
    return toBusinessDate(new Date(), 'Europe/Rome');
  }
}

function mask(phone: string | null): string {
  if (phone === null) {
    return '-';
  }
  return phone.length <= 4
    ? '****'
    : `${phone.slice(0, 3)}${'*'.repeat(phone.length - 5)}${phone.slice(-2)}`;
}

function cut(s: string | null, max: number): string {
  if (s === null) {
    return '-';
  }
  const pulito = s.replace(/\s+/g, ' ').trim();
  return pulito.length > max ? `${pulito.slice(0, max - 1)}…` : pulito;
}

function stampaPlanning(giornata: IsoDate, records: readonly InfinityPlanningRecord[]): void {
  const righe = records.map((r) => ({
    Ora: r.oraPrenotazione,
    Doc: `${r.tipoDoc} ${r.numDoc}/${r.anno ?? '?'}${r.genereDoc === 'L' ? ' (commessa)' : ''}`,
    Targa: r.targa ?? '-',
    Cliente: cut(r.cliente ?? `Cliente ${r.idCliente}`, 26),
    Telefono: mask(r.telefono),
    Veicolo: cut(
      [r.marcaDescrizione, r.modelloDescrizione ?? r.modelloCodice]
        .filter((x) => x !== null)
        .join(' ') || null,
      30,
    ),
    Accettatore: cut(r.accettatoreNome ?? r.accettatoreCodice, 18),
    Stato: r.annullata ? 'annullata' : r.chiusa ? 'chiusa' : r.confermato ? 'confermata' : 'aperta',
    Ore: r.tempoStimatoOre === null ? '-' : String(r.tempoStimatoOre),
    Lavorazioni: cut(
      r.lavorazioni.length > 0
        ? r.lavorazioni.join(' · ')
        : r.tempi.map((t) => t.descrizione).join(' · ') || null,
      44,
    ),
    Note: cut(r.noteDoc ?? r.noteCliente, 30),
  }));
  console.log(`\n=== Planning Infinity del ${giornata}: ${records.length} prenotazioni ===`);
  console.table(righe);
  const senzaTarga = records.filter((r) => r.targa === null).length;
  const senzaNome = records.filter((r) => r.cliente === null).length;
  const conLavorazioni = records.filter((r) => r.lavorazioni.length > 0).length;
  const conTelefono = records.filter((r) => r.telefono !== null).length;
  console.log(
    `Riepilogo: ${records.length} prenotazioni, ${records.length - senzaTarga} con targa, ` +
      `${records.length - senzaNome} con nome cliente, ${conTelefono} con cellulare, ${conLavorazioni} con lavorazioni.`,
  );
}

function stampaAccessi(esiti: readonly InfinityAccessCheck[]): void {
  console.log("\n=== Verifica accessi dell'utenza del DSN (sola lettura) ===");
  console.table(
    esiti.map((e) => ({
      Oggetto: e.oggetto,
      Tipo: e.tipo,
      Livello: e.livello,
      Esito: e.ok ? 'OK' : 'NEGATO',
      Scopo: cut(e.scopo, 60),
    })),
  );
  const negati = esiti.filter((e) => !e.ok);
  if (negati.length === 0) {
    console.log('Tutti gli oggetti sono accessibili: nessun GRANT da richiedere.');
    return;
  }
  console.log("GRANT da richiedere all'IT del gestionale (sostituire <utente_dsn>):");
  for (const e of negati) {
    console.log(`  ${e.grant}   -- ${e.livello}: ${e.scopo}`);
  }
}

describe.skipIf(DSN === '')('Infinity ODBC (database reale, sola lettura)', () => {
  const config = DSN === '' ? null : resolveInfinityRealConfig('Europe/Rome');
  const logger = new ConsoleLogger('[infinity:check]', 'info');
  const clock = new RealClock();
  const service =
    config === null
      ? null
      : new InfinityServiceOdbc(config, {
          client: new SqlAnywhereOdbcClient({
            connectionString: buildConnectionString(config),
            loginTimeoutSec: config.loginTimeoutSec,
            queryTimeoutSec: config.queryTimeoutSec,
          }),
          clock,
          logger,
        });
  const giornata: IsoDate = isIsoDate(GIORNATA_RAW) ? GIORNATA_RAW : clock.today();

  it('si connette e riconosce il motore SQL Anywhere', async () => {
    const health = await service!.healthCheck();
    console.log(`\nConnessione: ${describeConnection(config!)}`);
    console.log(
      `Health: ${health.status} · ${health.detail ?? ''} · ${health.latencyMs ?? '?'} ms`,
    );
    expect(health.status).toBe('UP');
    expect(health.implementation).toBe('real');
    expect(health.detail).toContain('12.');
  }, 60_000);

  it("verifica gli accessi dell'utenza del DSN e propone i GRANT mancanti", async () => {
    const esiti = await service!.checkAccess(giornata);
    stampaAccessi(esiti);
    expect(esiti.filter((e) => e.livello === 'obbligatorio').every((e) => e.ok)).toBe(true);
  }, 120_000);

  it('estrae il planning della giornata con i campi essenziali', async () => {
    const records = await service!.fetchPlanningRecords(giornata);
    console.log(`\nSorgente del planning: ${service!.planningSourceInUse ?? '?'}`);
    stampaPlanning(giornata, records);
    for (const r of records) {
      expect(config!.bookingDocTypes).toContain(r.tipoDoc);
      expect(r.dataPrenotazione).toBe(giornata);
      expect(r.oraPrenotazione).toMatch(/^\d{2}:\d{2}$/);
      expect(r.idDocumento).toBeGreaterThan(0);
    }
  }, 120_000);

  it("restituisce l'agenda nella forma DTO usata dalla sync", async () => {
    const result = await service!.fetchDailyAgenda(giornata);
    expect(result.ok).toBe(true);
    if (result.ok) {
      console.log(
        `\nAgenda DTO: ${result.value.appointments.length} appuntamenti, partial=${String(result.value.partial)}`,
      );
      const primo = result.value.appointments[0];
      if (primo !== undefined) {
        console.log('Primo appuntamento (DTO):', {
          ...primo,
          customer: { ...primo.customer, phone: mask(primo.customer.phone) },
        });
        expect(primo.externalId).toMatch(/^PRE-\d+$/);
        expect(primo.scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
  }, 120_000);
});
