'use client';

// Form di ricerca della targa (portale cliente, mobile-first): campo unico in evidenza con
// formattazione live, validazione in italiano e pulsante grande adatto al dito su smartphone.
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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="targa" className="text-lg font-semibold text-slate-900">
          Targa del veicolo
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
          aria-describedby="targa-aiuto"
          aria-invalid={error !== null}
          onChange={(event) => {
            setPlate(formatPlateInput(event.target.value));
            setError(null);
          }}
          className="h-16 w-full rounded-xl border-2 border-slate-300 bg-white text-center font-mono text-3xl font-bold tracking-[0.2em] text-slate-900 uppercase shadow-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-300 focus-visible:border-slate-900 focus-visible:ring-4 focus-visible:ring-slate-300 focus-visible:outline-none"
        />
        <p id="targa-aiuto" className="text-base text-slate-600">
          Digita la targa senza spazi, come è scritta sul veicolo.
        </p>
      </div>

      {error !== null ? (
        <p
          role="alert"
          className="bg-status-no-show-soft rounded-lg px-4 py-3 text-base text-red-900"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="h-touch w-full rounded-xl bg-slate-900 px-6 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 focus-visible:ring-4 focus-visible:ring-slate-400 focus-visible:outline-none disabled:opacity-60"
      >
        {submitting ? 'Ricerca in corso…' : 'Vedi il mio turno'}
      </button>
    </form>
  );
}
