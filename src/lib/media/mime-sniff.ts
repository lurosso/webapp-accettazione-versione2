// Tipo REALE di un file dai suoi primi byte (magic number), senza fidarsi del Content-Type.
//
// Il tablet dichiara `file.type`, ma è il client a dirlo: un eseguibile rinominato `.jpg` arriva
// con `image/jpeg` e passerebbe qualunque allowlist basata sulla dichiarazione. Qui si guarda
// dentro il file: JPEG, PNG e WebP hanno una firma fissa in testa; HEIC, MP4, QuickTime, M4V e
// 3GPP sono tutti contenitori ISO BMFF e si riconoscono dal box `ftyp` e dai suoi "brand"; WebM è
// un EBML con DocType `webm`. Tutto il resto — SVG, HTML, PDF, ZIP, eseguibili — è `null`.
//
// Funzione pura, senza dipendenze: la usa il servizio dei media e la provano i test con byte veri.

/** I tipi che il sistema sa riconoscere: coincidono con quelli ammessi al check-in. */
export type SniffedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'video/mp4'
  | 'video/quicktime'
  | 'video/webm'
  | 'video/x-m4v'
  | 'video/3gpp';

/** Quanti byte servono al massimo per decidere: oltre non si guarda. */
export const SNIFF_BYTES = 64;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];

/**
 * Brand ISO BMFF → tipo. Il brand principale (byte 8-11) decide; se non è noto si scorrono i
 * brand compatibili del box `ftyp`, perché iPhone e Android mettono spesso un brand generico
 * davanti (`mif1`, `isom`) e quello specifico dopo.
 */
const MIME_BY_BRAND: Readonly<Record<string, SniffedMime>> = {
  // HEIF/HEIC (fotocamera iPhone/iPad).
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  hevx: 'image/heic',
  heim: 'image/heic',
  heis: 'image/heic',
  hevm: 'image/heic',
  hevs: 'image/heic',
  mif1: 'image/heic',
  msf1: 'image/heic',
  // QuickTime (registrazione video iOS).
  'qt  ': 'video/quicktime',
  // M4V (iTunes/Apple).
  'M4V ': 'video/x-m4v',
  M4VH: 'video/x-m4v',
  M4VP: 'video/x-m4v',
  // 3GPP (Android meno recenti).
  '3gp4': 'video/3gpp',
  '3gp5': 'video/3gpp',
  '3gp6': 'video/3gpp',
  '3gp7': 'video/3gpp',
  '3ge6': 'video/3gpp',
  '3ge7': 'video/3gpp',
  '3gg6': 'video/3gpp',
  // MP4 in tutte le sue varianti.
  isom: 'video/mp4',
  iso2: 'video/mp4',
  iso4: 'video/mp4',
  iso5: 'video/mp4',
  iso6: 'video/mp4',
  mp41: 'video/mp4',
  mp42: 'video/mp4',
  avc1: 'video/mp4',
  dash: 'video/mp4',
  MSNV: 'video/mp4',
  mmp4: 'video/mp4',
};

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

/** Contenitore ISO BMFF: box `ftyp` in testa, brand principale poi quelli compatibili. */
function sniffIsoBmff(bytes: Uint8Array): SniffedMime | null {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') {
    return null;
  }
  const boxSize =
    ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  const principale = MIME_BY_BRAND[ascii(bytes, 8, 4)];
  if (principale !== undefined) {
    return principale;
  }
  // Brand compatibili: da byte 16 fino alla fine del box (o dei byte disponibili), a gruppi di 4.
  const fine = Math.min(boxSize > 16 ? boxSize : SNIFF_BYTES, bytes.length, SNIFF_BYTES);
  for (let i = 16; i + 4 <= fine; i += 4) {
    const compatibile = MIME_BY_BRAND[ascii(bytes, i, 4)];
    if (compatibile !== undefined) {
      return compatibile;
    }
  }
  return null;
}

/** EBML con DocType `webm` nei primi byte; un Matroska generico (`matroska`) non è ammesso. */
function sniffWebm(bytes: Uint8Array): SniffedMime | null {
  if (!startsWith(bytes, EBML_SIGNATURE)) {
    return null;
  }
  return ascii(bytes, 0, Math.min(bytes.length, SNIFF_BYTES)).includes('webm')
    ? 'video/webm'
    : null;
}

/**
 * Tipo del file dai primi byte, oppure `null` se non è una foto o un video fra quelli ammessi.
 * Un file troncato sotto i 12 byte non è mai riconosciuto.
 */
export function sniffMediaMime(bytes: Uint8Array): SniffedMime | null {
  if (bytes.length < 12) {
    return null;
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return sniffIsoBmff(bytes) ?? sniffWebm(bytes);
}

/** Foto o video, dal tipo riconosciuto. */
export function mediaKindOf(mime: SniffedMime): 'PHOTO' | 'VIDEO' {
  return mime.startsWith('image/') ? 'PHOTO' : 'VIDEO';
}
