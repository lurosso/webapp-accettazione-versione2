// Veicolo: snapshot embedded nella pratica; la targa normalizzata è la chiave del portale.

import type { BrandId, VehicleId } from '../ids';
import type { PlateNumber } from '../value-objects/plate';

/** Veicolo della pratica. */
export interface Vehicle {
  readonly id: VehicleId;
  readonly plate: PlateNumber;
  readonly brandId: BrandId;
  readonly model: string;
  readonly vin: string | null;
}
