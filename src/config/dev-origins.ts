// Da quali indirizzi il dev server accetta richieste alle proprie risorse (HMR, chunk, RSC).
//
// Next blocca per sicurezza le richieste «cross-origin» alle risorse di sviluppo: se apri
// http://10.50.193.83:3000 da un iPad, la pagina HTML arriva ma il client non si idrata — i
// pulsanti esistono e non fanno niente (il modulo di login parte in GET con i campi nell'indirizzo)
// e nel log compare «Blocked cross-origin request to Next.js dev resource». Il rimedio previsto è
// `allowedDevOrigins`, ma l'indirizzo Wi-Fi del PC cambia con la rete (192.168.178.45 un giorno,
// 10.50.193.83 quello dopo, 10.50.193.91 il 24/09): scriverlo a mano vuol dire rompersi al primo
// cambio di ufficio.
//
// Prima (M8-T35) si leggevano gli IPv4 della macchina all'avvio. Non basta: Next legge la
// configurazione UNA volta, e se il Wi-Fi si collega o cambia indirizzo dopo l'avvio del dev
// server (il PC acceso la mattina, il DHCP che rinnova) il nuovo IP resta fuori e l'iPad torna a
// non idratarsi. Ora, oltre agli indirizzi rilevati e a quelli in ALLOWED_DEV_ORIGINS, entrano i
// jolly delle reti private (10.*, 172.16–31.*, 192.168.*) e dei nomi mDNS (*.local), che Next
// confronta segmento per segmento: qualunque indirizzo di rete locale prenda il PC, oggi o fra
// un'ora, è già dentro. Un sito pubblico resta fuori. ALLOWED_DEV_ORIGINS_LAN=false torna ai soli
// indirizzi rilevati. Vale solo per il dev server: in produzione Next ignora l'opzione.
import { networkInterfaces } from 'node:os';

/** Il minimo di `os.NetworkInterfaceInfo` che serve qui, così la funzione si prova senza rete. */
export interface InterfacciaRete {
  readonly family: string | number;
  readonly internal: boolean;
  readonly address: string;
}

/**
 * Le reti private (RFC 1918) e i nomi mDNS, nella sintassi a segmenti di `allowedDevOrigins`
 * (`*` = un segmento qualsiasi). 172.16.0.0/12 non si scrive con un jolly solo: sono sedici righe.
 */
export const LAN_DEV_ORIGIN_PATTERNS: readonly string[] = [
  '10.*.*.*',
  '192.168.*.*',
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
  '*.local',
];

/**
 * Indirizzi IPv4 non di loopback della macchina, più quelli extra (separati da virgola), senza
 * duplicati e nell'ordine: prima i propri, poi quelli scritti a mano.
 */
export function devOriginsFrom(
  interfaces: Readonly<Record<string, readonly InterfacciaRete[] | undefined>>,
  extra: string | undefined,
): readonly string[] {
  const propri = Object.values(interfaces)
    .flatMap((lista) => lista ?? [])
    .filter((i) => (i.family === 'IPv4' || i.family === 4) && !i.internal)
    .map((i) => i.address);
  const aggiunti = (extra ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set([...propri, ...aggiunti])];
}

/** I jolly di rete locale sono attivi salvo ALLOWED_DEV_ORIGINS_LAN=false (o 0, no, off). */
export function lanDevOriginsEnabled(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

/** Le origini di sviluppo di QUESTA macchina: gli indirizzi di adesso più, di norma, la rete locale. */
export function devOrigins(): readonly string[] {
  const rilevati = devOriginsFrom(networkInterfaces(), process.env['ALLOWED_DEV_ORIGINS']);
  return lanDevOriginsEnabled(process.env['ALLOWED_DEV_ORIGINS_LAN'])
    ? [...new Set([...rilevati, ...LAN_DEV_ORIGIN_PATTERNS])]
    : rilevati;
}
