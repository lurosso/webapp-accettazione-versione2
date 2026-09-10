// Repository dei dati di configurazione (seed) in memoria.

import type { Bay } from '@/domain/entities/bay';
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import type { Workstation } from '@/domain/entities/workstation';
import type { BayId, DeskId, WorkstationId } from '@/domain/ids';
import { sameReferenceCode } from '@/domain/value-objects/code';
import type { IReferenceDataRepository } from '../interfaces/IReferenceDataRepository';
import type { InMemoryStore } from './InMemoryStore';

/** Dati di riferimento in memoria. */
export class InMemoryReferenceDataRepository implements IReferenceDataRepository {
  constructor(private readonly store: InMemoryStore) {}

  async listBrands(): Promise<readonly Brand[]> {
    return [...this.store.state.brands];
  }

  /** Stessa normalizzazione del mapper Infinity: "Alfa Romeo" → ALFA_ROMEO. */
  async findBrandByCode(code: string): Promise<Brand | null> {
    return this.store.state.brands.find((b) => sameReferenceCode(b.code, code)) ?? null;
  }

  async listDesks(): Promise<readonly Desk[]> {
    return [...this.store.state.desks];
  }

  async findDeskById(id: DeskId): Promise<Desk | null> {
    return this.store.state.desks.find((d) => d.id === id) ?? null;
  }

  async listWorkstations(): Promise<readonly Workstation[]> {
    return [...this.store.state.workstations];
  }

  async findWorkstationById(id: WorkstationId): Promise<Workstation | null> {
    return this.store.state.workstations.find((w) => w.id === id) ?? null;
  }

  async listBays(): Promise<readonly Bay[]> {
    return [...this.store.state.bays].sort((a, b) => a.number - b.number);
  }

  async findBayById(id: BayId): Promise<Bay | null> {
    return this.store.state.bays.find((b) => b.id === id) ?? null;
  }

  async findBayByCode(code: string): Promise<Bay | null> {
    return this.store.state.bays.find((b) => sameReferenceCode(b.code, code)) ?? null;
  }
}
