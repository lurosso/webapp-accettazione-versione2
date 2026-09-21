// Sicurezza upload: il tipo lo decide il contenuto, non il nome né il Content-Type dichiarato.
import { describe, expect, it } from 'vitest';
import { mediaKindOf, sniffMediaMime } from '@/lib/media/mime-sniff';
import {
  exeBytes,
  heicBytes,
  htmlBytes,
  jpegBytes,
  mkvBytes,
  movBytes,
  mp4Bytes,
  mp4GenericoBytes,
  pdfBytes,
  pngBytes,
  svgBytes,
  webmBytes,
  webpBytes,
} from '../helpers/media-bytes';

describe('Sicurezza upload: riconoscimento del tipo dai byte', () => {
  it('riconosce le foto dei tablet: JPEG, PNG, WebP, HEIC', () => {
    expect(sniffMediaMime(jpegBytes())).toBe('image/jpeg');
    expect(sniffMediaMime(pngBytes())).toBe('image/png');
    expect(sniffMediaMime(webpBytes())).toBe('image/webp');
    expect(sniffMediaMime(heicBytes())).toBe('image/heic');
    expect(mediaKindOf('image/heic')).toBe('PHOTO');
  });

  it('riconosce i video: MP4 (anche con brand generico), QuickTime, WebM', () => {
    expect(sniffMediaMime(mp4Bytes())).toBe('video/mp4');
    expect(sniffMediaMime(mp4GenericoBytes())).toBe('video/mp4');
    expect(sniffMediaMime(movBytes())).toBe('video/quicktime');
    expect(sniffMediaMime(webmBytes())).toBe('video/webm');
    expect(mediaKindOf('video/webm')).toBe('VIDEO');
  });

  it('rifiuta tutto ciò che non è una foto o un video ammessi, qualunque sia il nome', () => {
    expect(sniffMediaMime(exeBytes())).toBeNull();
    expect(sniffMediaMime(svgBytes())).toBeNull();
    expect(sniffMediaMime(htmlBytes())).toBeNull();
    expect(sniffMediaMime(pdfBytes())).toBeNull();
    expect(sniffMediaMime(mkvBytes())).toBeNull();
    expect(sniffMediaMime(new Uint8Array(2048).fill(7))).toBeNull();
    expect(sniffMediaMime(new Uint8Array(0))).toBeNull();
    expect(sniffMediaMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('non si lascia ingannare da una firma messa in fondo o in mezzo al file', () => {
    const finto = new Uint8Array(2048).fill(0x41);
    finto.set([0xff, 0xd8, 0xff], 100);
    expect(sniffMediaMime(finto)).toBeNull();
    const ftypFuoriPosto = new Uint8Array(64).fill(0);
    ftypFuoriPosto.set(
      [...'ftyp'].map((c) => c.charCodeAt(0)),
      20,
    );
    expect(sniffMediaMime(ftypFuoriPosto)).toBeNull();
  });
});
