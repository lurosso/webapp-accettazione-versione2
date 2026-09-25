// Tipi di `spoki-spec.mjs`, usati dal test.
export interface CampoSpoki {
  readonly code: string;
  readonly tipo: number;
  readonly esempio: string;
  readonly descrizione: string;
}
export interface TemplateSpoki {
  readonly name: string;
  /** Tipo Spoki del messaggio dell'app; null = template non ancora usato. */
  readonly tipo: string | null;
  readonly env: string | null;
  readonly testo: string;
  readonly intestazione?: string;
  readonly pulsanti: readonly string[];
}
export interface PulsanteSpoki {
  readonly testo: string;
  readonly payload: string;
  readonly chiave: 'arrivato' | 'ritardo' | 'assente';
}
export interface IdSpoki {
  readonly campi: Readonly<Record<string, number | string | null>>;
  readonly template: Readonly<Record<string, number | string | null>>;
}
export const TIPO_CAMPO: { readonly TESTO: number; readonly DATA: number };
export const CAMPI: readonly CampoSpoki[];
export const CAMPI_AUTOMAZIONI: readonly CampoSpoki[];
export const ESITO_IN_ATTESA: string;
export const RISPOSTA_VUOTA: string;
export const PULSANTI: readonly PulsanteSpoki[];
export const PULSANTI_PRENOTAZIONE: readonly { readonly testo: string; readonly payload: string }[];
export const TEMPLATE_ESISTENTI: readonly TemplateSpoki[];
export const TEMPLATE_DA_CREARE: readonly TemplateSpoki[];
export const TEMPLATE: readonly TemplateSpoki[];
export const ESEMPI: Readonly<Record<string, string>>;
export const RISERVA: Readonly<Record<'arrivato' | 'ritardo' | 'assente', string>>;
export const AUTOMAZIONI: Readonly<Record<'arrivato' | 'ritardo' | 'assente' | 'rete', string>>;
export const EVENTI_WEBHOOK: readonly string[];
export function stessoNome(a: string, b: string): boolean;
export function variabiliDi(testo: string): string[];
export function componi(testo: string, valori: Readonly<Record<string, string>>): string;
export function corpoTemplate(t: TemplateSpoki): Record<string, unknown>;
export function urlWebhook(appUrl: string): string;
export function corpoAutomazioneRisposta(
  pulsante: PulsanteSpoki,
  opzioni: { readonly ids: IdSpoki; readonly appUrl: string; readonly inboundSecret: string },
): Record<string, unknown> & { readonly steps: readonly Record<string, unknown>[] };
export function corpoAutomazioneRete(opzioni: {
  readonly ids: IdSpoki;
  readonly ora: string;
}): Record<string, unknown> & { readonly steps: readonly Record<string, unknown>[] };
