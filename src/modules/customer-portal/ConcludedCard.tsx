// Pratica conclusa da oltre 24 ore o di una giornata passata: schermata cortese e chiara, senza
// coda né pulsanti. Il cliente che riapre il link il giorno dopo capisce subito che non c'è nulla
// da attendere. Solo codice, titolo e una frase (M8-T56).
import Link from 'next/link';
import type { PortalStatusView } from '@/domain/read-models';
import { cn } from '@/lib/utils/cn';
import { concludedMessage } from './status-messages';

export interface ConcludedCardProps {
  readonly position: PortalStatusView;
}

export function ConcludedCard({ position }: ConcludedCardProps) {
  const message = concludedMessage(position.status);
  return (
    <section
      role="status"
      data-testid="portal-concluded"
      className={cn(
        'flex flex-col items-center gap-5 rounded-3xl border-2 px-5 py-7 text-center shadow-sm',
        message.tone === 'done'
          ? 'border-brand-primary bg-status-completed-soft'
          : 'border-line bg-surface',
      )}
    >
      <p className="text-ink-soft font-mono text-5xl font-black tracking-wider tabular-nums">
        {position.code}
      </p>
      <h1 className="text-ink text-3xl font-bold">{message.headline}</h1>
      <p className="text-ink-soft text-xl">{message.detail}</p>
      <Link
        href="/cliente"
        className="bg-surface-inverse focus-anello premibile flex min-h-16 w-full items-center justify-center rounded-2xl px-6 text-xl font-bold text-white"
      >
        Cerca un&apos;altra targa
      </Link>
    </section>
  );
}
