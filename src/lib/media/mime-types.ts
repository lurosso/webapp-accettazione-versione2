// Tabella UNICA dei tipi di media ammessi e delle loro estensioni su disco.
//
// La usano il servizio che accetta i file (`InspectionService`) e lo storage che li rilegge
// (`MediaStorageLocalDisk`): prima erano due tabelle diverse, e un video QuickTime accettato in
// ingresso tornava indietro come `application/octet-stream` perché lo storage non conosceva `.mov`.
// Il Content-Type con cui un file viene servito deriva SOLO da questa tabella, mai da ciò che il
// client ha dichiarato: è questo che impedisce di far servire un HTML come immagine.

/** Immagini accettate dalle fotocamere dei tablet. */
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

/**
 * Video accettati: mp4 e QuickTime (iPad/iPhone), webm e 3gpp (Android). Il file viene conservato
 * così com'è: nessuna transcodifica, perché il browser che lo rilegge è lo stesso che l'ha girato.
 */
export const ALLOWED_VIDEO_MIME = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/3gpp',
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];
export type AllowedVideoMime = (typeof ALLOWED_VIDEO_MIME)[number];
export type AllowedMediaMime = AllowedImageMime | AllowedVideoMime;

/** Estensione del file nello storage per ogni tipo ammesso (la chiave la porta sempre con sé). */
export const EXTENSION_BY_MIME: Readonly<Record<AllowedMediaMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
};

/** Tipo da servire in lettura, ricavato dall'estensione della chiave. */
export const MIME_BY_EXTENSION: Readonly<Record<string, AllowedMediaMime>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  '3gp': 'video/3gpp',
};

export function isAllowedMediaMime(value: string): value is AllowedMediaMime {
  return (
    (ALLOWED_IMAGE_MIME as readonly string[]).includes(value) ||
    (ALLOWED_VIDEO_MIME as readonly string[]).includes(value)
  );
}
