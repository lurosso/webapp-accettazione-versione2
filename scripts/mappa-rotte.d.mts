// Tipi dello script `mappa-rotte.mjs`, usati dal test.
export interface RottaDescritta {
  readonly path: string;
  readonly area: string;
  readonly descrizione: string;
  readonly accesso: string;
}
export interface RottaTrovata {
  readonly path: string;
  readonly kind: 'page' | 'api';
  readonly methods: readonly string[];
  readonly file: string;
}
export interface Mappa {
  readonly righe: readonly (RottaDescritta & RottaTrovata)[];
  readonly senzaDescrizione: readonly string[];
  readonly stantie: readonly string[];
}
export const AREE: readonly string[];
export const ROTTE: readonly RottaDescritta[];
export const README_INIZIO: string;
export const README_FINE: string;
export function scanRoutes(appDir: string): RottaTrovata[];
export function mappa(appDir: string): Mappa;
export function renderMarkdown(m: Mappa): string;
export function renderConsole(m: Mappa): string;
export function aggiornaReadme(readmePath: string, markdown: string): void;
