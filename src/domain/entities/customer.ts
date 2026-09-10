// Cliente: snapshot embedded nella pratica. Mai esposto dal portale pubblico.

import type { CustomerId } from '../ids';
import type { PhoneE164 } from '../value-objects/phone';

/** Cliente della pratica. `phone` null → NO_RECIPIENT; `whatsappOptIn` false → si passa subito a SMS. */
export interface Customer {
  readonly id: CustomerId;
  /** Riferimento nel sistema esterno (Infinity), null per inserimenti manuali. */
  readonly externalRef: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: PhoneE164 | null;
  readonly email: string | null;
  readonly whatsappOptIn: boolean;
}

/** Nome completo per i log e i payload CRM. */
export function customerFullName(c: Pick<Customer, 'firstName' | 'lastName'>): string {
  return `${c.firstName} ${c.lastName}`.trim();
}
