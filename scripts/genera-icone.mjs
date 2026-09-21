// Genera le icone PNG della PWA senza dipendenze: apple-touch-icon (180), icon-192, icon-512.
//
// iOS ignora le icone SVG del manifest e, senza un `apple-touch-icon` in PNG, mette sulla
// schermata Home uno screenshot della pagina. Non c'è una libreria grafica nel progetto e non
// vale la pena aggiungerne una per tre quadrati: il PNG si scrive a mano (firma, IHDR, IDAT
// deflate, IEND, con i CRC) e il disegno si calcola pixel per pixel.
//
// Il disegno riprende `icona-checkin.svg`: fondo blu scuro del marchio, cerchio verde lime, segno
// di spunta bianco. Angoli arrotondati sul fondo; la versione `maskable` la ritaglia il sistema.
//
//   node scripts/genera-icone.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLU = [0x00, 0x46, 0x6f];
const LIME = [0x87, 0xbd, 0x22];
const BIANCO = [0xff, 0xff, 0xff];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dati) {
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(dati.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([lunghezza, corpo, crc]);
}

/** Distanza di un punto dal segmento AB: serve per disegnare il tratto della spunta. */
function distanzaDaSegmento(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  return Math.hypot(px - qx, py - qy);
}

/** Colore di un pixel (con un po' di antialiasing sui bordi delle forme). */
function pixel(x, y, n) {
  const cx = n / 2;
  const cy = n / 2;
  // Fondo: quadrato con angoli arrotondati (raggio 18%); fuori è trasparente.
  const r = n * 0.18;
  const dx = Math.max(Math.abs(x + 0.5 - cx) - (cx - r), 0);
  const dy = Math.max(Math.abs(y + 0.5 - cy) - (cy - r), 0);
  const fuori = Math.hypot(dx, dy) - r;
  if (fuori > 0.5) {
    return [0, 0, 0, 0];
  }
  const alphaFondo = Math.max(0, Math.min(1, 0.5 - fuori));
  // Cerchio lime al centro, raggio 34%.
  const dCerchio = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - n * 0.34;
  // Spunta bianca: due segmenti, spessore 7%.
  const spessore = n * 0.07;
  const d1 = distanzaDaSegmento(x + 0.5, y + 0.5, n * 0.36, n * 0.5, n * 0.46, n * 0.61);
  const d2 = distanzaDaSegmento(x + 0.5, y + 0.5, n * 0.46, n * 0.61, n * 0.66, n * 0.39);
  const dSpunta = Math.min(d1, d2) - spessore;
  let colore = BLU;
  if (dCerchio < 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dCerchio));
    colore = colore.map((c, i) => Math.round(c * (1 - a) + LIME[i] * a));
  }
  if (dSpunta < 0.5) {
    const a = Math.max(0, Math.min(1, 0.5 - dSpunta));
    colore = colore.map((c, i) => Math.round(c * (1 - a) + BIANCO[i] * a));
  }
  return [...colore, Math.round(alphaFondo * 255)];
}

function png(n) {
  const righe = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    const base = y * (n * 4 + 1);
    righe[base] = 0; // filtro: nessuno
    for (let x = 0; x < n; x++) {
      const [r, g, b, a] = pixel(x, y, n);
      righe.set([r, g, b, a], base + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; // bit per canale
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(righe, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const cartella = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(cartella, { recursive: true });
for (const [nome, n] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  const dati = png(n);
  writeFileSync(join(cartella, nome), dati);
  console.log(`${nome}: ${n}×${n}, ${dati.length} byte`);
}
