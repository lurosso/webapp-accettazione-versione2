// Barra di avanzamento a tre tappe del portale cliente: In attesa → In accettazione →
// Accettazione conclusa. Tappe passate in verde Autoclub, tappa corrente in blu, future in
// grigio. Con tono "attention" (assente, annullata) la barra resta spenta.
import type { PortalStage } from '@/domain/read-models';
import { cn } from '@/lib/utils/cn';
import { PORTAL_STAGES, type StatusTone } from './status-messages';

export interface ProgressStepsProps {
  readonly stage: PortalStage;
  readonly tone: StatusTone;
}

export function ProgressSteps({ stage, tone }: ProgressStepsProps) {
  const spenta = tone === 'attention';
  return (
    <ol
      className="grid grid-cols-3 gap-1"
      aria-label="Avanzamento della pratica"
      data-stage={stage}
      data-testid="progress-steps"
    >
      {PORTAL_STAGES.map((s) => {
        const fatta = !spenta && s.stage < stage;
        const corrente = !spenta && s.stage === stage;
        return (
          <li
            key={s.stage}
            aria-current={corrente ? 'step' : undefined}
            data-state={fatta ? 'done' : corrente ? 'current' : 'todo'}
            className="flex flex-col items-center gap-1.5 text-center"
          >
            <span
              className={cn(
                'block h-2 w-full rounded-full transition-colors',
                fatta && 'bg-brand-primary',
                corrente && 'bg-brand-secondary',
                !fatta && !corrente && 'bg-slate-200',
              )}
            />
            <span
              className={cn(
                'text-[11px] leading-tight font-semibold [overflow-wrap:anywhere] sm:text-xs',
                corrente
                  ? 'text-brand-secondary'
                  : fatta
                    ? 'text-brand-lime-dark'
                    : 'text-ink-muted',
              )}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
