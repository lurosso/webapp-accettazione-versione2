'use client';

// Testo lungo che non sfonda la griglia.
//
// La lavorazione e le note arrivano da Infinity e possono essere lunghissime: una sola nota
// occupava mezzo schermo di tablet e spingeva fuori vista le pratiche successive, così la coda
// sembrava disordinata per colpa di un cliente prolisso. Qui il testo sta in due righe e si apre
// sul posto, con un comando da 44 px.
//
// Il comando compare solo se il testo è davvero tagliato, misurato sull'elemento: un "Mostra
// tutto" sotto una riga e mezza è rumore. La misura si rifà quando la finestra cambia larghezza,
// perché un tablet ruotato taglia in un punto diverso.
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';

export interface ExpandableTextProps {
  readonly children: string;
  /** Righe visibili da chiuso. */
  readonly lines?: 2 | 3;
  /** Cosa si apre, per chi ascolta la pagina: «Mostra tutta la lavorazione richiesta». */
  readonly label?: string;
  /** `quiet` sta dentro una riga di tabella; `block` ha il fondo dei blocchi in ombra. */
  readonly variant?: 'quiet' | 'block';
  readonly className?: string | undefined;
}

const CLAMP: Record<2 | 3, string> = {
  2: 'line-clamp-2',
  3: 'line-clamp-3',
};

export function ExpandableText({
  children,
  lines = 2,
  label = 'il testo',
  variant = 'quiet',
  className,
}: ExpandableTextProps) {
  const paragrafo = useRef<HTMLParagraphElement>(null);
  const [espanso, setEspanso] = useState(false);
  const [troncato, setTroncato] = useState(false);

  const misura = useCallback((): void => {
    const elemento = paragrafo.current;
    // Da aperto non c'è niente da misurare, e il comando deve restare per poter richiudere.
    if (elemento === null || espanso) {
      return;
    }
    setTroncato(elemento.scrollHeight - elemento.clientHeight > 1);
  }, [espanso]);

  useEffect(() => {
    misura();
    const elemento = paragrafo.current;
    if (elemento === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const osservatore = new ResizeObserver(() => misura());
    osservatore.observe(elemento);
    return () => osservatore.disconnect();
  }, [misura, children]);

  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        variant === 'block' && 'bg-surface-sunken rounded-md px-4 py-3.5',
        className,
      )}
    >
      <p
        ref={paragrafo}
        className={cn('text-ink-soft text-sm leading-relaxed', !espanso && CLAMP[lines])}
      >
        {children}
      </p>
      {troncato ? (
        <button
          type="button"
          onClick={() => setEspanso((aperto) => !aperto)}
          aria-expanded={espanso}
          aria-label={espanso ? `Riduci ${label}` : `Mostra tutto ${label}`}
          className={cn(
            'focus-anello premibile text-brand-blue-dark min-h-touch -mx-2 inline-flex w-fit items-center gap-1.5 rounded-md px-2 text-sm font-semibold',
            variant === 'block' && '-mb-2',
          )}
        >
          {espanso ? 'Riduci' : 'Mostra tutto'}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={cn(
              'ease-smooth size-4 transition-transform duration-200',
              espanso && 'rotate-180',
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 6 8 10.5 12.5 6" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
