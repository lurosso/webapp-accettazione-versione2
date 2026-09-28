// Schermate di errore del portale cliente: targa non trovata, targa non valida, troppe richieste,
// servizio non disponibile. Nessun dettaglio tecnico: un titolo, una frase su cosa fare, un
// pulsante grande per riprovare (M8-T56).
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
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
        detail:
          plate === ''
            ? "Non troviamo l'appuntamento di oggi. Si rivolga all'accettazione."
            : `Oggi non c'è un appuntamento per la targa ${plate}. Controlli la targa o si rivolga all'accettazione.`,
        tone: 'attention',
      };
    case 'invalid-plate':
      return {
        title: 'Targa non valida',
        detail: 'Scriva la targa come è sulla sua auto, per esempio AB123CD.',
        tone: 'attention',
      };
    case 'rate-limited':
      return {
        title: 'Un attimo di pazienza',
        detail: 'Sono state fatte molte ricerche di seguito. Riprovi fra qualche istante.',
        tone: 'neutral',
      };
    case 'unavailable':
      return {
        title: 'Servizio non disponibile',
        detail: "Al momento non riusciamo a mostrare il suo turno. Si rivolga all'accettazione.",
        tone: 'neutral',
      };
  }
}

export function ServiceUnavailableCard({ problem, plate }: ServiceUnavailableCardProps) {
  const copy = copyFor(problem, plate);
  return (
    <section
      role="alert"
      className={cn(
        'flex flex-col items-center gap-5 rounded-3xl border-2 px-5 py-7 text-center shadow-sm',
        copy.tone === 'attention'
          ? 'bg-status-no-show-soft border-status-no-show/40'
          : 'border-line bg-surface',
      )}
    >
      <h1 className="text-ink text-3xl font-bold">{copy.title}</h1>
      <p className="text-ink-soft text-xl">{copy.detail}</p>
      <Link
        href="/cliente"
        className="bg-surface-inverse focus-anello premibile flex min-h-16 w-full items-center justify-center rounded-2xl px-6 text-xl font-bold text-white"
      >
        Riprovi
      </Link>
    </section>
  );
}
