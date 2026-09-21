// Byte di prova per foto e video: firme VERE in testa, riempimento dietro. Da quando il server
// riconosce il tipo dal contenuto, un `Uint8Array` pieno di 7 non è più "una foto".
function conFirma(firma: readonly number[], size: number, riempimento = 0x07): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, firma.length)).fill(riempimento);
  bytes.set(firma, 0);
  return bytes;
}

function ascii(testo: string): number[] {
  return [...testo].map((c) => c.charCodeAt(0));
}

/** Box `ftyp` ISO BMFF: dimensione, "ftyp", brand principale, versione, brand compatibili. */
function ftyp(principale: string, compatibili: readonly string[]): number[] {
  const dimensione = 16 + compatibili.length * 4;
  return [
    (dimensione >>> 24) & 0xff,
    (dimensione >>> 16) & 0xff,
    (dimensione >>> 8) & 0xff,
    dimensione & 0xff,
    ...ascii('ftyp'),
    ...ascii(principale),
    0,
    0,
    0,
    0,
    ...compatibili.flatMap(ascii),
  ];
}

/** JPEG (SOI + APP0 «JFIF»). */
export const jpegBytes = (size = 2048): Uint8Array =>
  conFirma([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0x00], size);

/** PNG. */
export const pngBytes = (size = 2048): Uint8Array =>
  conFirma([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size);

/** WebP (RIFF … WEBP). */
export const webpBytes = (size = 2048): Uint8Array =>
  conFirma([...ascii('RIFF'), 0x00, 0x10, 0x00, 0x00, ...ascii('WEBP'), ...ascii('VP8 ')], size);

/** HEIC come lo scrive un iPhone: brand principale `heic`, compatibili `mif1 heic`. */
export const heicBytes = (size = 2048): Uint8Array =>
  conFirma(ftyp('heic', ['mif1', 'heic']), size);

/** MP4 (brand `isom`, compatibili `isom iso2 avc1 mp41`). */
export const mp4Bytes = (size = 4096): Uint8Array =>
  conFirma(ftyp('isom', ['isom', 'iso2', 'avc1', 'mp41']), size);

/** MP4 con brand principale generico ma `mp42` fra i compatibili (Android). */
export const mp4GenericoBytes = (size = 4096): Uint8Array =>
  conFirma(ftyp('xxxx', ['mp42', 'isom']), size);

/** QuickTime (`qt  `). */
export const movBytes = (size = 4096): Uint8Array => conFirma(ftyp('qt  ', ['qt  ']), size);

/** WebM: EBML con DocType `webm`. */
export const webmBytes = (size = 4096): Uint8Array =>
  conFirma(
    [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...ascii('webm')],
    size,
  );

/** Matroska generico (stesso EBML, DocType `matroska`): non ammesso. */
export const mkvBytes = (size = 4096): Uint8Array =>
  conFirma(
    [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88, ...ascii('matroska')],
    size,
  );

/** Eseguibile Windows (`MZ`), quello che qualcuno rinomina in .jpg. */
export const exeBytes = (size = 2048): Uint8Array => conFirma([0x4d, 0x5a, 0x90, 0x00], size);

/** SVG: XML con script dentro, sarebbe eseguito se servito inline. */
export const svgBytes = (): Uint8Array =>
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );

/** HTML travestito. */
export const htmlBytes = (): Uint8Array =>
  new TextEncoder().encode('<!doctype html><html><body><script>alert(1)</script></body></html>');

/** PDF. */
export const pdfBytes = (size = 2048): Uint8Array => conFirma(ascii('%PDF-1.7\n'), size);
