'use client';

// Ricerca della targa (portale cliente, mobile): un campo grande con la targa formattata mentre si
// scrive (spazi e trattini li toglie il campo, non il cliente) e un pulsante grande. Nessun testo
// d'aiuto fisso (M8-T56): l'esempio è nel campo, e una spiegazione compare solo se serve, cioè
// quando la targa non va.
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { formatPlateInput, PLATE_MAX_LENGTH, plateErrorMessage } from './plate-input';

export interface PlateSearchFormProps {
  /** Targa già digitata (es. tornando indietro dalla schermata di stato). */
  readonly initialPlate?: string;
  /** Corsia di provenienza del QR, propagata nell'URL per capire quale QR viene usato. */
  readonly source?: string | undefined;
}

export function PlateSearchForm({ initialPlate = '', source }: PlateSearchFormProps) {
  const router = useRouter();
  const [plate, setPlate] = useState(formatPlateInput(initialPlate));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const message = plateErrorMessage(plate);
    if (message !== null) {
      setError(message);
      return;
    }
    setError(null);
    setSubmitting(true);
    const search = new URLSearchParams({ targa: formatPlateInput(plate) });
    if (source !== undefined && source !== '') {
      search.set('src', source);
    }
    router.push(`/cliente/stato?${search.toString()}`);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="targa" className="text-ink text-xl font-semibold">
          Targa della sua auto
        </label>
        <input
          id="targa"
          name="targa"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={PLATE_MAX_LENGTH}
          placeholder="AB123CD"
          value={plate}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? 'targa-errore' : undefined}
          onChange={(event) => {
            setPlate(formatPlateInput(event.target.value));
            setError(null);
          }}
          className="border-line focus-anello text-ink placeholder:text-ink-muted/40 min-h-20 w-full rounded-2xl border-2 bg-white text-center font-mono text-4xl font-bold tracking-[0.2em] uppercase shadow-sm placeholder:font-normal placeholder:tracking-normal"
        />
      </div>

      {error !== null ? (
        <p
          id="targa-errore"
          role="alert"
          className="bg-status-no-show-soft text-status-no-show-ink rounded-xl px-4 py-3 text-lg font-semibold"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="bg-brand-secondary active:bg-brand-blue-dark premibile focus-anello flex min-h-16 w-full items-center justify-center rounded-2xl px-6 text-2xl font-bold text-white shadow-sm disabled:opacity-60"
      >
        {submitting ? 'Un istante…' : 'Vedi il mio turno'}
      </button>
    </form>
  );
}
