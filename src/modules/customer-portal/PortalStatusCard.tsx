// Pagina di tracciamento del cliente (mobile, brandizzata Autoclub): si apre dal link WhatsApp o
// dal QR in officina.
//
// ESSENZIALE (M8-T56, 2026-09-28): chi la guarda è spesso una persona anziana, in auto, in fila
// davanti all'officina, che dà un'occhiata al telefono ogni tanto. Sulla scheda ci sono solo:
// 1. il codice, grande, perché è quello che sentirà chiamare (con la targa sotto, per essere sicuri
//    che sia la propria auto);
// 2. UNA frase grande sullo stato e UNA frase su cosa fare;
// 3. mentre aspetta, quante auto ci sono prima di lui; quando tocca a lui, la lettera dello
//    sportello, che diventa la cosa più grande della pagina;
// 4. i due pulsanti, quando servono.
// Niente barra delle tappe, orari, accettatore o sede: erano informazioni giuste ma da ufficio, e
// facevano cercare la cosa importante in mezzo alle altre.
import type { PortalStatusView } from '@/domain/read-models';
import { cn } from '@/lib/utils/cn';
import { aheadCountMessage, statusMessage, type StatusTone } from './status-messages';

export interface PortalStatusCardProps {
  readonly position: PortalStatusView;
  /** True mentre il polling sta riprovando dopo un errore: lo stato mostrato è l'ultimo noto. */
  readonly stale: boolean;
  /** I pulsanti «Sono qui» e «Sono in ritardo» (o le loro conferme), quando hanno senso. */
  readonly action?: React.ReactNode;
}

/*
 * Il colore fa metà del lavoro. In attesa: bianco e blu istituzionale, niente che chieda
 * attenzione, perché non c'è niente da fare. Chiamato: il verde del marchio prende tutta la
 * scheda, con il bordo spesso — da mezzo metro si vede che è cambiato qualcosa prima ancora di
 * mettere a fuoco le parole.
 */
const TONE_CARD: Record<StatusTone, string> = {
  waiting: 'border-line bg-surface',
  serving: 'border-brand-primary bg-brand-primary/15 ring-4 ring-brand-primary/20',
  done: 'border-brand-primary bg-status-completed-soft',
  attention: 'border-status-no-show/40 bg-status-no-show-soft',
};

const TONE_CODE: Record<StatusTone, string> = {
  waiting: 'text-brand-blue-dark',
  serving: 'text-ink-forte',
  done: 'text-status-completed-ink',
  attention: 'text-status-no-show-ink',
};

export function PortalStatusCard({ position, stale, action }: PortalStatusCardProps) {
  const message = statusMessage(position.status, position.bayCode);
  const inFila = message.showAheadCount && position.queuePosition !== null;
  const allosportello = position.status === 'IN_PROGRESS' && position.bayCode !== null;

  return (
    <section
      aria-labelledby="stato-titolo"
      data-testid="portal-status"
      data-status={position.status}
      className={cn(
        'flex flex-col items-center gap-6 rounded-3xl border-2 px-5 py-7 text-center shadow-sm',
        TONE_CARD[message.tone],
      )}
    >
      <div className="flex flex-col items-center gap-1">
        <p className="text-ink-soft text-lg font-semibold">Il suo codice</p>
        <p
          className={cn(
            'font-mono text-7xl leading-none font-black tracking-wider tabular-nums',
            TONE_CODE[message.tone],
          )}
          data-testid="codice"
        >
          {position.code}
        </p>
        <p className="text-ink-soft mt-1 text-lg">
          Targa{' '}
          <span className="text-ink font-mono font-bold tracking-widest">{position.plate}</span>
        </p>
      </div>

      <div className="flex flex-col items-center gap-3" aria-live="polite">
        <h1 id="stato-titolo" className="text-ink text-4xl font-bold tracking-tight">
          {message.headline}
        </h1>

        {allosportello ? (
          // È il suo turno: la lettera dello sportello è la cosa più grande della pagina, su fondo
          // verde e con l'alone che respira. È l'unica cosa che deve cercare mentre avanza.
          <div
            className="chiamata-pulsa bg-brand-primary flex flex-col items-center rounded-3xl px-10 py-4 shadow-lg"
            data-testid="sportello"
          >
            <span className="text-ink-forte text-lg font-bold tracking-[0.3em] uppercase">
              Sportello
            </span>
            <span className="text-ink-forte text-8xl leading-none font-black">
              {position.bayCode}
            </span>
          </div>
        ) : null}

        {inFila ? (
          <p className="text-ink text-2xl font-semibold" data-testid="ahead-count">
            {aheadCountMessage(position.aheadCount)}
          </p>
        ) : null}

        <p className="text-ink-soft text-xl">{message.detail}</p>
      </div>

      {action}

      {stale ? (
        <p role="status" className="text-status-in-progress-ink text-lg font-semibold">
          Connessione lenta: stiamo riprovando.
        </p>
      ) : null}
    </section>
  );
}
