// Pratica conclusa da oltre 24 ore o di una giornata passata: schermata cortese e chiara, senza
// coda né pulsanti. Il cliente che riapre il link il giorno dopo capisce subito che non c'è nulla
// da attendere.
import Link from 'next/link';
import type { PortalStatusView } from '@/domain/read-models';
import { formatBusinessDateIt, localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { concludedMessage } from './status-messages';

export interface ConcludedCardProps {
  readonly position: PortalStatusView;
  readonly timeZone: string;
}

export function ConcludedCard({ position, timeZone }: ConcludedCardProps) {
  const message = concludedMessage(position.status);
  return (
    <section
      role="status"
      data-testid="portal-concluded"
      className={cn(
        'flex flex-col gap-4 rounded-3xl border-2 p-6 text-center shadow-sm',
        message.tone === 'done'
          ? 'border-brand-primary bg-status-completed-soft'
          : 'border-slate-300 bg-white',
      )}
    >
      <p className="font-mono text-4xl font-black tracking-wider text-slate-700 tabular-nums">
        {position.code}
      </p>
      <h1 className="text-2xl font-bold text-slate-900">{message.headline}</h1>
      <p className="text-lg text-slate-700">{message.detail}</p>
      <p className="text-sm text-slate-500">
        Appuntamento del {formatBusinessDateIt(position.businessDate)} alle{' '}
        {localTimeHHmm(new Date(position.scheduledAt), timeZone)} · targa {position.plate}
        {position.concludedAt !== null
          ? ` · chiusa alle ${localTimeHHmm(new Date(position.concludedAt), timeZone)}`
          : ''}
      </p>
      <Link
        href="/cliente"
        className="h-touch mx-auto flex w-full max-w-xs items-center justify-center rounded-xl bg-slate-900 px-6 text-lg font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:ring-4 focus-visible:ring-slate-400 focus-visible:outline-none"
      >
        Cerca un&apos;altra targa
      </Link>
    </section>
  );
}
