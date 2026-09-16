import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/config/seed';
import { FALLBACK_BRAND_CODE } from '@/domain/entities/brand';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { hashPassword } from '@/lib/hash-password';
import type { InfinityAppointmentDto } from '@/services/dto/infinity.dto';
import { mapInfinityAppointment } from '@/services/mappers/infinity.mapper';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';

const GIORNATA = '2026-09-16' as IsoDate;

function dto(brandCode: string, vehicleModel = 'Tucson 1.6 CRDi'): InfinityAppointmentDto {
  return {
    externalId: 'PRE-31842',
    scheduledAt: '2026-09-16T06:30:00.000Z',
    brandCode,
    plate: 'GT003JH',
    vin: null,
    vehicleModel,
    customer: {
      externalId: '390947',
      firstName: 'MARIO',
      lastName: 'ROSSI',
      phone: null,
      email: null,
      whatsappOptIn: null,
    },
    serviceDescription: 'TAGLIANDO',
    deskCode: null,
    cancelled: false,
    updatedAt: '2026-09-16T06:00:00.000Z',
  };
}

function contesto(profile: 'demo' | 'real') {
  const seed =
    profile === 'demo'
      ? buildSeedData()
      : buildSeedData({
          seedProfile: 'real',
          seedAdminPasswordHash: hashPassword('Prova-2026-ABCD'),
          seedDisplayTokenSecret: 'segreto-dei-display-di-prova-2026',
        });
  return {
    brands: seed.brands,
    desks: seed.desks,
    ids: new SequentialIdGenerator('t'),
    businessDate: GIORNATA,
  };
}

describe('Mapper Infinity: marchi non in elenco', () => {
  it('senza marchio di ripiego nel seed la pratica viene scartata (VALIDATION), come prima', () => {
    const esito = mapInfinityAppointment(dto('HYUNDAI'), contesto('demo'));
    expect(esito.ok).toBe(false);
    if (!esito.ok) {
      expect(esito.error.code).toBe('VALIDATION');
      expect(esito.error.message).toContain('Marchio sconosciuto');
    }
  });

  it('con «Altri marchi» nel seed la pratica entra in coda e la marca vera resta davanti al modello', () => {
    const esito = mapInfinityAppointment(dto('HYUNDAI'), contesto('real'));
    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.value.brand.code).toBe(FALLBACK_BRAND_CODE);
      expect(esito.value.vehicle.model).toBe('HYUNDAI Tucson 1.6 CRDi');
      expect(esito.value.vehicle.plate).toBe('GT003JH');
    }
    // Un codice con underscore si legge come marca ("ALFA ROMEO"): qui però il marchio esiste.
    const alfa = mapInfinityAppointment(dto('ALFA_ROMEO', 'Tonale 1.5'), contesto('real'));
    expect(alfa.ok && alfa.value.brand.code === 'ALFA_ROMEO').toBe(true);
    expect(alfa.ok && alfa.value.vehicle.model === 'Tonale 1.5').toBe(true);
  });

  it('i marchi veri del planning di Bari (DS, Leapmotor, EMC, XEV) hanno il loro marchio, non il ripiego', () => {
    for (const [codice, modello] of [
      ['DS', 'DS 7 Crossback'],
      ['LEAPMOTOR', 'T03'],
      ['EMC', 'Sei 1.5 Gpl'],
      ['XEV', 'YOYO PRO'],
    ] as const) {
      const esito = mapInfinityAppointment(dto(codice, modello), contesto('real'));
      expect(esito.ok).toBe(true);
      if (esito.ok) {
        expect(esito.value.brand.code).toBe(codice);
        expect(esito.value.vehicle.model).toBe(modello);
      }
    }
  });
});
