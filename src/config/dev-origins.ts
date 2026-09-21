// Da quali indirizzi il dev server accetta richieste alle proprie risorse (HMR, chunk, RSC).
//
// Next blocca per sicurezza le richieste «cross-origin» alle risorse di sviluppo: se apri
// http://10.50.193.83:3000 da un iPad, la pagina HTML arriva ma il client non si idrata — i
// pulsanti esistono e non fanno niente, e nel log compare «Blocked cross-origin request to
// Next.js dev resource». Il rimedio previsto è `allowedDevOrigins`, ma l'indirizzo Wi-Fi del PC
// cambia con la rete (192.168.178.45 un giorno, 10.50.193.83 quello dopo): scriverlo a mano vuol
// dire rompersi al primo cambio di ufficio.
//
// Qui si leggono gli indirizzi IPv4 della macchina stessa al momento dell'avvio — qualunque rete
// sia — più quelli indicati a mano in ALLOWED_DEV_ORIGINS (un nome mDNS, un alias). Vale solo
// per il dev server: in produzione Next ignora l'opzione, e il file non tocca nulla del runtime.
import { networkInterfaces } from 'node:os';

/** Il minimo di `os.NetworkInterfaceInfo` che serve qui, così la funzione si prova senza rete. */
export interface InterfacciaRete {
  readonly family: string | number;
  readonly internal: boolean;
  readonly address: string;
}

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

/** Le origini di sviluppo di QUESTA macchina, adesso. */
export function devOrigins(): readonly string[] {
  return devOriginsFrom(networkInterfaces(), process.env['ALLOWED_DEV_ORIGINS']);
}
