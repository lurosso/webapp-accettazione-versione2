// Glossario IT→EN del dominio: unica fonte per tradurre i termini dell'officina
// in identificatori di codice. Genera docs/GLOSSARIO.md (M0).

/** Voce del glossario: termine italiano, identificatore inglese e nota d'uso. */
export interface GlossaryEntry {
  readonly it: string;
  readonly en: string;
  readonly note?: string;
}

/** Glossario ufficiale del progetto (ordine: concetti principali, poi stati e azioni). */
export const GLOSSARY = [
  {
    it: 'pratica',
    en: 'Appointment',
    note: "Aggregate root; nasce dall'appuntamento in agenda e vive per la giornata operativa",
  },
  { it: 'accettatore', en: 'Operator', note: 'Ruoli: ADVISOR, SUPERVISOR (responsabile), ADMIN' },
  {
    it: 'accettazione',
    en: 'reception',
    note: 'Modulo A: modules/reception; il segmento URL /accettazione resta in italiano',
  },
  {
    it: 'sportello (fisico)',
    en: 'Bay',
    note:
      '4 sportelli A, B, C, D con monitor; occupazione derivata dalla pratica IN_PROGRESS. ' +
      'A schermo si chiama "Sportello A": la lettera è quella sulla targhetta del banco ed è ciò ' +
      'che si dice al cliente (richiesta del committente, 2026-09-17; prima erano "Accettazione N"). ' +
      'Nel codice e nei dati resta Bay, con `number` come ordinale interno.',
  },
  {
    it: 'area per marchio',
    en: 'Desk',
    note:
      'Filtro Brand/Sportello: FCA (sportelli A e B) e PSA (sportelli C e D); distinto dallo ' +
      'sportello fisico e dalla postazione.',
  },
  {
    it: 'postazione',
    en: 'Workstation',
    note:
      "PC fisico dell'accettatore, scelto al login; Vista Multi-Postazione. A schermo si legge " +
      '"Sportello A", come lo sportello fisico che le corrisponde (committente, 2026-09-17).',
  },
  {
    it: 'targa',
    en: 'plate / PlateNumber',
    note: 'Normalizzata maiuscola senza spazi; chiave di ricerca del portale',
  },
  {
    it: 'presa in carico / In Carico',
    en: 'takeInCharge / IN_PROGRESS',
    note: 'Azione "Prendi in carico" e relativo stato',
  },
  {
    it: 'salta / Salta',
    en: 'skip / SKIPPED',
    note: 'Pratica momentaneamente posposta; skipCount',
  },
  {
    it: 'completato / Completato',
    en: 'complete / COMPLETED',
    note: 'Libera lo sportello; il monitor mostra RELEASING poi FREE',
  },
  { it: 'in attesa / In Attesa', en: 'WAITING', note: 'Stato iniziale scaricato da Infinity' },
  { it: 'rilascio', en: 'release', note: 'IN_PROGRESS → WAITING (annulla la presa in carico)' },
  {
    it: 'annullato',
    en: 'CANCELLED',
    note: 'Appuntamento sparito o annullato in Infinity; il codice non viene mai riutilizzato',
  },
  {
    it: 'no-show / appuntamento non rispettato',
    en: 'NO_SHOW',
    note: 'Trigger del modulo F verso CRM/BDC',
  },
  {
    it: 'prenotazione',
    en: 'booking (scheduledAt)',
    note: 'Orario di prenotazione = chiave di ordinamento della coda',
  },
  {
    it: 'agenda',
    en: 'daily agenda (InfinityAgendaDto)',
    note: 'Elenco appuntamenti del giorno acquisito da Infinity alle 06:00',
  },
  { it: 'sincronizzazione', en: 'sync / SyncRun', note: 'Idempotente, non distruttiva' },
  { it: 'brand / marchio', en: 'Brand', note: 'Marchi della concessionaria multimarca' },
  {
    it: 'codice progressivo',
    en: 'QueueCode',
    note: 'F001, F002…; identità immutabile, non posizione in coda',
  },
  { it: 'cliente', en: 'Customer', note: 'Mai esposto dal portale pubblico' },
  { it: 'veicolo / vettura', en: 'Vehicle' },
  { it: 'giornata operativa', en: 'businessDate', note: 'YYYY-MM-DD in Europe/Rome' },
  {
    it: 'coda',
    en: 'queue',
    note: 'Pratiche WAITING/SKIPPED ordinate per (scheduledAt, sequence)',
  },
  {
    it: 'promemoria',
    en: 'reminder (REMINDER_PREVIOUS_DAY, REMINDER_SAME_DAY)',
    note: 'WhatsApp via Spoki, fallback SMS Hosting',
  },
  {
    it: 'contatto manuale',
    en: 'MANUAL_REQUIRED / confirmManual',
    note: 'Fallback UI quando entrambi i canali falliscono',
  },
  { it: 'anomalia di flusso', en: 'CrmOutboxEvent (ANOMALY)', note: 'Modulo F' },
  {
    it: 'BDC',
    en: 'BDC (Business Development Center)',
    note: 'Destinatario del ricontatto via CRM',
  },
  {
    it: 'fascicolo',
    en: 'appointment media (MediaAsset)',
    note: 'Foto/video associati alla pratica (P5)',
  },
] as const satisfies readonly GlossaryEntry[];
