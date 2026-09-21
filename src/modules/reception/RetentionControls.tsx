'use client';

// Conservazione dei media di una pratica: perché le foto ci sono ancora, e chi può cambiarlo.
//
// Sta in un modulo suo perché serve in due posti che non hanno niente in comune: il pannello di
// dettaglio della coda (la pratica di oggi) e l'archivio delle ispezioni (la pratica di tre mesi
// fa, che è proprio quella su cui un contenzioso arriva). Un vincolo legale si mette quasi sempre
// dopo, cercando la targa in archivio — e lì il pulsante non c'era.
//
// Il tempo da solo non cancella: serve la commessa chiusa e nessun vincolo legale. Qui si legge
// quale delle tre condizioni manca. Togliere una protezione è il gesto da confermare — è quello che
// permette la cancellazione — mentre metterla è un tocco solo: si sbaglia in una direzione sola, e
// non è quella che perde i dati.
import { useState } from 'react';
import { retentionProtection, type Appointment } from '@/domain/entities/appointment';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoldButton } from '@/components/ui/hold-button';
import type { RetentionPatchInput } from '@/lib/api-client/client';
import { formatDateTimeIt } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';

/** Quel che serve sapere di una pratica per parlare della conservazione dei suoi media. */
export type PraticaConservazione = Pick<
  Appointment,
  'status' | 'orderClosedAt' | 'legalHoldAt' | 'legalHoldReason'
> & {
  /** `string` e non `QueueCode`: l'archivio lo porta già spogliato del tipo marcato. */
  readonly code: string;
};

/** I comandi dell'amministratore; assente per gli altri ruoli, che leggono e non decidono. */
export type ComandiConservazione =
  { readonly onChange: (patch: RetentionPatchInput) => Promise<void> } | undefined;

export interface ConservazioneProps {
  readonly a: PraticaConservazione;
  readonly timeZone: string;
  readonly retention: ComandiConservazione;
}

export function Conservazione({ a, timeZone, retention }: ConservazioneProps) {
  const [motivo, setMotivo] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const protezione = retentionProtection(a);
  const senzaCommessa = a.status === 'NO_SHOW' || a.status === 'CANCELLED';

  const applica = async (patch: RetentionPatchInput): Promise<void> => {
    if (retention === undefined) {
      return;
    }
    setInCorso(true);
    setErrore(null);
    try {
      await retention.onChange(patch);
      setMotivo('');
    } catch (cause) {
      setErrore(cause instanceof Error ? cause.message : 'Operazione non riuscita.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="conservazione-media">
      <p className="testo-corpo text-ink-soft">
        {a.legalHoldAt !== null ? (
          <>
            Protetti da un <strong className="text-ink">vincolo legale</strong> dal{' '}
            {formatDateTimeIt(a.legalHoldAt, timeZone)}
            {a.legalHoldReason !== null ? ` · ${a.legalHoldReason}` : ''}: non scadono finché il
            vincolo non viene tolto.
          </>
        ) : protezione === 'ORDER_OPEN' ? (
          <>
            Protetti: la <strong className="text-ink">commessa è aperta</strong>. Scadranno solo
            dopo la chiusura, trascorsa la retention.
          </>
        ) : senzaCommessa ? (
          <>
            Nessuna commessa (pratica {a.status === 'NO_SHOW' ? 'assente' : 'annullata'}): scadono
            con la sola retention.
          </>
        ) : a.orderClosedAt !== null ? (
          <>
            Commessa chiusa il {formatDateTimeIt(a.orderClosedAt, timeZone)}: scadono trascorsa la
            retention.
          </>
        ) : null}
      </p>

      {retention !== undefined ? (
        <div className="flex flex-col gap-2">
          {a.legalHoldAt === null ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="testo-nota text-ink-soft font-semibold">
                  Motivo del vincolo (facoltativo)
                </span>
                <input
                  value={motivo}
                  onChange={(event) => setMotivo(event.target.value)}
                  maxLength={200}
                  placeholder="es. contestazione graffio paraurti"
                  className="controllo border-line bg-surface testo-corpo focus-anello w-full rounded-md border px-3"
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={inCorso}
                data-testid="metti-vincolo"
                onClick={() =>
                  void applica({
                    legalHold: true,
                    legalHoldReason: motivo.trim() === '' ? null : motivo.trim(),
                  })
                }
              >
                Metti vincolo legale
              </Button>
            </div>
          ) : (
            <HoldButton
              variant="outline"
              size="sm"
              disabled={inCorso}
              data-testid="togli-vincolo"
              confirmLabel="Confermi? I media torneranno a scadere"
              actionLabel={`Togli il vincolo legale dalla pratica ${a.code}`}
              onConfirm={() => void applica({ legalHold: false })}
            >
              Togli vincolo legale
            </HoldButton>
          )}

          {senzaCommessa ? null : a.orderClosedAt === null ? (
            <HoldButton
              variant="outline"
              size="sm"
              disabled={inCorso}
              data-testid="chiudi-commessa"
              confirmLabel="Confermi? I media potranno scadere"
              actionLabel={`Segna chiusa la commessa della pratica ${a.code}`}
              onConfirm={() => void applica({ orderClosed: true })}
            >
              Segna commessa chiusa
            </HoldButton>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={inCorso}
              data-testid="riapri-commessa"
              onClick={() => void applica({ orderClosed: false })}
            >
              Riapri commessa
            </Button>
          )}
        </div>
      ) : null}

      {errore !== null ? (
        <p role="alert" className="testo-nota text-status-no-show-ink">
          {errore}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Il riquadro in evidenza: bordo colorato quando qualcosa protegge i media, pastiglia che dice
 * cosa. È la forma con cui la conservazione compare dove si decide — in alto nel dettaglio della
 * coda per l'amministratore, e in fondo a ogni scheda dell'archivio.
 */
export function RiquadroConservazione({ a, timeZone, retention }: ConservazioneProps) {
  const protezione = retentionProtection(a);
  return (
    <div
      data-testid="conservazione-in-evidenza"
      className={cn(
        'rounded-lg border-2 p-4',
        protezione === null
          ? 'border-line bg-surface-sunken'
          : 'border-status-in-progress bg-status-in-progress-soft',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ink testo-dato font-bold">Conservazione dei media</h3>
        <Badge
          tone={
            protezione === 'LEGAL_HOLD'
              ? 'danger'
              : protezione === 'ORDER_OPEN'
                ? 'warning'
                : 'neutral'
          }
        >
          {protezione === 'LEGAL_HOLD'
            ? 'Vincolo legale'
            : protezione === 'ORDER_OPEN'
              ? 'Protetti · commessa aperta'
              : 'Scadono con la retention'}
        </Badge>
      </div>
      <Conservazione a={a} timeZone={timeZone} retention={retention} />
    </div>
  );
}
