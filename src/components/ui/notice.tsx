// Riga di avviso: l'esito di un comando, un errore, una cosa da sapere.
//
// `Alert` è il cartello grande, con titolo e azioni: si usa per le cose che fermano il lavoro. Per
// tutto il resto c'era un paragrafo scritto a mano — «rounded-md bg-status-no-show-soft px-3 py-2 text-sm
// text-status-no-show-ink» — ricopiato in venticinque punti, con venticinque idee leggermente diverse di che
// rosso fosse il rosso. Questo è quel paragrafo, una volta sola, sui colori del sistema.
//
// Il `role` non è una scelta di stile: `alert` interrompe chi ascolta la pagina ed è giusto solo
// per gli errori; per un esito riuscito basta `status`, che aspetta una pausa.
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface NoticeProps extends HTMLAttributes<HTMLParagraphElement> {
  readonly tone?: NoticeTone;
}

const TONE_CLASSES: Record<NoticeTone, string> = {
  info: 'bg-status-info-soft text-status-info-ink',
  success: 'bg-status-completed-soft text-status-completed-ink',
  warning: 'bg-status-in-progress-soft text-status-in-progress-ink',
  error: 'bg-status-no-show-soft text-status-no-show-ink',
};

export function Notice({ tone = 'info', className, children, ...props }: NoticeProps) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('testo-corpo rounded-md px-3 py-2', TONE_CLASSES[tone], className)}
      {...props}
    >
      {children}
    </p>
  );
}
