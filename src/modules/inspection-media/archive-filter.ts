// Filtro dell'archivio: «Solo con foto/video». Funzione pura, separata dal componente, così si
// prova senza montare la pagina.
/** Il minimo che serve al filtro: quante voci ha l'elenco dei file. */
interface WithPhotos {
  readonly photos: readonly unknown[];
}

/** Una scheda "ha media" quando c'è almeno un file allegato, foto o video, anche se archiviato. */
export function hasMedia(entry: WithPhotos): boolean {
  return entry.photos.length > 0;
}

/**
 * Le schede da mostrare: tutte, oppure solo quelle con almeno un file. L'ordine non cambia: il
 * filtro toglie, non riordina.
 */
export function filterArchiveEntries<T extends WithPhotos>(
  entries: readonly T[],
  onlyWithMedia: boolean,
): readonly T[] {
  return onlyWithMedia ? entries.filter(hasMedia) : entries;
}

/** Riga di conteggio sotto la barra: «12 pratiche» oppure «3 con foto/video su 12». */
export function archiveCountLabel(shown: number, total: number, onlyWithMedia: boolean): string {
  if (onlyWithMedia) {
    return `${shown} con foto/video su ${total}`;
  }
  return total === 1 ? '1 pratica' : `${total} pratiche`;
}
