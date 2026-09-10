// Dati di configurazione: marchi, sportelli, postazioni e campate.

import type { Bay } from '@/domain/entities/bay';
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import type { Workstation } from '@/domain/entities/workstation';
import type { BayId, DeskId, WorkstationId } from '@/domain/ids';

/** Repository dei dati di riferimento (seed nello scaffold, tabelle di configurazione in futuro). */
export interface IReferenceDataRepository {
  listBrands(): Promise<readonly Brand[]>;
  findBrandByCode(code: string): Promise<Brand | null>;
  listDesks(): Promise<readonly Desk[]>;
  findDeskById(id: DeskId): Promise<Desk | null>;
  listWorkstations(): Promise<readonly Workstation[]>;
  findWorkstationById(id: WorkstationId): Promise<Workstation | null>;
  listBays(): Promise<readonly Bay[]>;
  findBayById(id: BayId): Promise<Bay | null>;
  findBayByCode(code: string): Promise<Bay | null>;
}
