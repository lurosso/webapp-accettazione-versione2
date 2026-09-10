// Marchi e modelli di una concessionaria multimarca (elenco reale da confermare col PO).

/** Modelli per codice marchio, usati per generare veicoli plausibili. */
export const MOCK_BRAND_MODELS: Readonly<Record<string, readonly string[]>> = {
  FIAT: ['500', 'Panda', 'Tipo', '600'],
  JEEP: ['Renegade', 'Compass', 'Avenger'],
  ALFA_ROMEO: ['Giulia', 'Stelvio', 'Tonale'],
  LANCIA: ['Ypsilon'],
  PEUGEOT: ['208', '3008', '2008'],
  CITROEN: ['C3', 'C4'],
  OPEL: ['Corsa', 'Mokka'],
};

/** Modello di ripiego quando il marchio non è nell'elenco. */
export const FALLBACK_MODEL = 'Modello non specificato';
