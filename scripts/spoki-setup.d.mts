// Tipi di `spoki-setup.mjs`, usati dal test.
export interface PianoSpoki {
  readonly campi: { code: string; id: number | string | null; tipoGiusto: boolean }[];
  readonly template: {
    name: string;
    env: string;
    id: number | string | null;
    stato: string | null;
  }[];
  readonly automazioni: {
    chiave: string;
    nome: string;
    id: number | string | null;
    attiva: boolean;
  }[];
  readonly webhook: { evento: string; id: number | string | null; attivo: boolean }[];
}
export function parseEnvText(testo: string): Record<string, string>;
export function aggiornaEnvText(testo: string, valori: Readonly<Record<string, string>>): string;
export function statoTemplate(t: Record<string, unknown>): string;
export function pianifica(
  stato: {
    readonly campi: readonly Record<string, unknown>[];
    readonly template: readonly Record<string, unknown>[];
    readonly automazioni: readonly Record<string, unknown>[];
    readonly webhook: readonly Record<string, unknown>[];
  },
  opzioni?: { readonly appUrl?: string | null },
): PianoSpoki;
/** Letture, creazioni e l'approvazione dei soli template appena creati; nient'altro. */
export function chiamataAmmessa(
  metodo: string,
  percorso: string,
  creatiOra?: ReadonlySet<string>,
): boolean;
