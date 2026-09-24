// Gli accettatori che Infinity assegna alle prenotazioni, per collegarli agli account dell'app.
//
// Infinity assegna ogni prenotazione a un accettatore (matricola di `o_operai`); l'app mostra a
// ciascuno «Le mie prenotazioni» incrociando quella matricola con quella scritta sul suo account.
// L'amministratore la matricola non la deve cercare nel gestionale: qui si leggono quelle comparse
// nel planning degli ultimi giorni (e dei prossimi), con il nome, quante prenotazioni hanno e
// l'account a cui sono già collegate.
import { addDays } from '@/lib/dates';
import { normalizeAdvisorCode, sameAdvisorCode } from '@/domain/value-objects/advisor-code';
import type { IAppointmentRepository, IOperatorRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';

export interface InfinityAdvisorView {
  readonly code: string;
  readonly name: string | null;
  /** Prenotazioni nel periodo guardato. */
  readonly appointments: number;
  /** Account dell'app già collegato a questa matricola, se c'è. */
  readonly linkedTo: { readonly operatorId: string; readonly displayName: string } | null;
}

export interface InfinityAdvisorDirectoryDeps {
  readonly appointments: IAppointmentRepository;
  readonly operators: IOperatorRepository;
  readonly clock: IClock;
}

/** Giorni guardati all'indietro e in avanti: abbastanza per vedere tutti quelli di turno. */
const GIORNI_INDIETRO = 14;
const GIORNI_AVANTI = 7;

export class InfinityAdvisorDirectory {
  constructor(private readonly deps: InfinityAdvisorDirectoryDeps) {}

  async list(): Promise<readonly InfinityAdvisorView[]> {
    const oggi = this.deps.clock.today();
    const giornate = Array.from({ length: GIORNI_INDIETRO + GIORNI_AVANTI + 1 }, (_, i) =>
      addDays(oggi, i - GIORNI_INDIETRO),
    );
    const [pratiche, operatori] = await Promise.all([
      Promise.all(
        giornate.map((g) => this.deps.appointments.listByDate(g, { includeCancelled: true })),
      ),
      this.deps.operators.listAll(),
    ]);
    const perCodice = new Map<string, { name: string | null; appointments: number }>();
    for (const a of pratiche.flat()) {
      const code = normalizeAdvisorCode(a.assignedAdvisor?.code);
      if (code === null) {
        continue;
      }
      const voce = perCodice.get(code) ?? { name: null, appointments: 0 };
      perCodice.set(code, {
        name: voce.name ?? a.assignedAdvisor?.name ?? null,
        appointments: voce.appointments + 1,
      });
    }
    return [...perCodice.entries()]
      .map(([code, v]) => {
        const collegato = operatori.find((o) => sameAdvisorCode(o.infinityAdvisorCode, code));
        return {
          code,
          name: v.name,
          appointments: v.appointments,
          linkedTo:
            collegato === undefined
              ? null
              : { operatorId: collegato.id, displayName: collegato.displayName },
        };
      })
      .sort((a, b) => (a.name ?? a.code).localeCompare(b.name ?? b.code, 'it'));
  }
}
