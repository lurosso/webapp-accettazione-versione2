// Regola dei "clienti prima di te": unica per portale, coda e messaggi al cliente.
//
// Ogni sportello serve la propria fila, quindi si contano solo le pratiche in coda dello stesso
// sportello. Lo sportello è quello indicato dall'agenda oppure, quando manca, quello che serve il
// marchio della vettura: la stessa regola con cui la dashboard raggruppa la coda, così il numero
// che il cliente legge sul telefono coincide con quello che vede l'accettatore. Il confronto usa
// l'orario effettivo: chi è stato rimesso in coda dopo un ritardo non risulta più davanti a chi
// era arrivato puntuale.
import { effectiveScheduleTime, type Appointment } from './entities/appointment';
import type { Desk } from './entities/desk';

/** Chiave della fila a cui appartiene la pratica (sportello esplicito, marchio, o fila a sé). */
export function deskKeyOf(a: Appointment, desks: readonly Desk[]): string {
  if (a.deskId !== null) {
    return a.deskId;
  }
  const desk = desks.find((d) => d.brandIds.includes(a.brandId));
  // Senza sportello né marchio riconosciuto la pratica fa fila a sé: meglio un conteggio prudente
  // che sommare clienti di sportelli diversi.
  return desk?.id ?? `brand:${a.brandId}`;
}

/**
 * Quante pratiche di `inQueue` precedono `appointment` nella stessa fila.
 * `inQueue` sono le pratiche ancora in coda (in attesa o saltate) della giornata; la pratica
 * stessa può esserci o no, viene esclusa in ogni caso.
 */
export function countAheadInSameDesk(
  appointment: Appointment,
  inQueue: readonly Appointment[],
  desks: readonly Desk[],
): number {
  const miaFila = deskKeyOf(appointment, desks);
  const mioOrario = effectiveScheduleTime(appointment);
  return inQueue.filter(
    (other) =>
      other.id !== appointment.id &&
      deskKeyOf(other, desks) === miaFila &&
      // A pari orario decide la sequenza del codice: l'ordine è quello della coda.
      (effectiveScheduleTime(other) < mioOrario ||
        (effectiveScheduleTime(other) === mioOrario && other.sequence < appointment.sequence)),
  ).length;
}
