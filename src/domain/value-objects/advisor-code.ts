// Matricola dell'accettatore in Infinity (`o_operai.matricola`, es. "102"): è il legame fra la
// prenotazione, che Infinity assegna a un accettatore, e l'account dell'operatore nell'app.
// Si confronta ripulita (spazi ai lati, maiuscole): nel gestionale le colonne sono CHAR a
// lunghezza fissa e arrivano con gli spazi in coda.

/** Matricola ripulita, oppure null se vuota o assente. */
export function normalizeAdvisorCode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return v === '' ? null : v;
}

/** Forma ammessa per una matricola scritta dall'amministratore. */
export const ADVISOR_CODE_PATTERN = /^[A-Z0-9._-]{1,20}$/;

/** True se le due matricole indicano lo stesso accettatore. */
export function sameAdvisorCode(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = normalizeAdvisorCode(a);
  return x !== null && x === normalizeAdvisorCode(b);
}
