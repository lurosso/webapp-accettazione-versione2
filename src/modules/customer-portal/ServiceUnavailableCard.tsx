// Schermate di errore del portale cliente: targa non trovata, targa non valida, troppe richieste,
// servizio non disponibile. Nessun dettaglio tecnico: sempre un'indicazione su cosa fare.
import Link from 'next/link';
import type { PublicStatusProblem } from './types';

export interface ServiceUnavailableCardProps {
  readonly problem: PublicStatusProblem;
  /** Targa cercata, mostrata per far capire cosa è stato digitato. */
  readonly plate: string;
}

interface ProblemCopy {
  readonly title: string;
  readonly detail: string;
  readonly tone: 'attention' | 'neutral';
}

function copyFor(problem: PublicStatusProblem, plate: string): ProblemCopy {
  switch (problem) {
    case 'not-found':
      return {
        title: 'Targa non trovata',
        detail: `Non risulta un appuntamento di oggi per la targa ${plate}. Controlla di averla digitata correttamente oppure rivolgiti allo sportello dell'accettazione.`,
        tone: 'attention',
      };
    case 'invalid-plate':
      return {
        title: 'Targa non valida',
        detail:
          'Il formato della targa non è corretto. Digitala senza spazi, come è scritta sul veicolo.',
        tone: 'attention',
      };
    case 'rate-limited':
      return {
        title: 'Troppe richieste',
        detail: 'Hai effettuato molte ricerche di seguito. Attendi qualche istante e riprova.',
        tone: 'neutral',
      };
    case 'unavailable':
      return {
        title: 'Servizio momentaneamente non disponibile',
        detail:
          "Non riusciamo a leggere lo stato della coda. Rivolgiti allo sportello dell'accettazione.",
        tone: 'neutral',
      };
  }
}

export function ServiceUnavailableCard({ problem, plate }: ServiceUnavailableCardProps) {
  const copy = copyFor(problem, plate);
  return (
    <section
      role="alert"
      className={`flex flex-col gap-4 rounded-2xl border-2 p-6 text-center shadow-sm ${
        copy.tone === 'attention'
          ? 'bg-status-no-show-soft border-red-300'
          : 'border-slate-300 bg-white'
      }`}
    >
      <h1 className="text-2xl font-bold text-slate-900">{copy.title}</h1>
      <p className="text-lg text-slate-700">{copy.detail}</p>
      <Link
        href="/cliente"
        className="h-touch mx-auto flex w-full max-w-xs items-center justify-center rounded-xl bg-slate-900 px-6 text-lg font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:ring-4 focus-visible:ring-slate-400 focus-visible:outline-none"
      >
        Cerca di nuovo
      </Link>
    </section>
  );
}
