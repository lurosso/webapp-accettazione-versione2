'use client';

// "Sono arrivato": il cliente dichiara di essere in officina dalla pagina di tracciamento, senza
// passare da WhatsApp. È il gesto che chiude il cerchio anche quando la messaggistica è in pausa.
//
// Il pulsante vive solo finché serve: appena l'ora è registrata sparisce e al suo posto resta una
// riga di conferma, ferma e piccola, perché l'informazione utile diventa un'altra (la posizione in
// fila). Un secondo tocco a schermo non può succedere — il pulsante non c'è più — e un secondo
// tocco dal telefono di qualcun altro, o da WhatsApp, non sposta l'ora già presa: lo garantisce il
// servizio, non questa schermata.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PortalStatusView } from '@/domain/read-models';
import { publicStatusKeys } from '@/hooks/usePublicStatus';
import { ApiError, postPublicArrival } from '@/lib/api-client/client';
import { localTimeHHmm } from '@/lib/dates';
import type { PublicStatus } from './types';

export interface ArrivalButtonProps {
  readonly position: PortalStatusView;
  readonly targa: string;
  readonly token: string | null;
  readonly timeZone: string;
}

/** Il pulsante ha senso solo per chi è ancora in fila e non si è già annunciato. */
export function canAnnounceArrival(position: PortalStatusView): boolean {
  return position.queuePosition !== null && position.arrivedAt === null && !position.expired;
}

export function ArrivalButton({ position, targa, token, timeZone }: ArrivalButtonProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => postPublicArrival({ targa: targa === '' ? position.plate : targa, token }),
    onSuccess: (data: PublicStatus) => {
      queryClient.setQueryData(publicStatusKeys.byLookup(targa, token), data);
    },
  });

  if (position.arrivedAt !== null) {
    return (
      <p
        role="status"
        data-testid="arrivo-registrato"
        className="text-center text-base font-semibold text-slate-600"
      >
        Ti abbiamo registrato in sala alle{' '}
        <strong className="font-mono">
          {localTimeHHmm(new Date(position.arrivedAt), timeZone)}
        </strong>
        . Attendi la chiamata.
      </p>
    );
  }
  if (!canAnnounceArrival(position)) {
    return null;
  }

  const errore =
    mutation.error instanceof ApiError
      ? mutation.error.status === 429
        ? 'Hai già avvisato da poco: riprova fra qualche minuto.'
        : mutation.error.message
      : mutation.isError
        ? 'Non siamo riusciti a registrare l’arrivo. Riprova o rivolgiti allo sportello.'
        : null;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        data-testid="sono-arrivato"
        className="bg-brand-secondary active:bg-brand-blue-dark flex min-h-14 w-full items-center justify-center rounded-2xl px-5 text-xl font-bold text-white shadow-sm focus-visible:ring-4 focus-visible:ring-sky-300 focus-visible:outline-none disabled:opacity-60"
      >
        {mutation.isPending ? 'Un istante…' : 'Sono arrivato in officina'}
      </button>
      <p className="text-center text-sm text-slate-500">
        Toccalo quando sei in sala: l&apos;accettazione saprà che ci sei. Il tuo turno non cambia.
      </p>
      {errore !== null ? (
        <p role="alert" className="text-center text-sm font-semibold text-red-800">
          {errore}
        </p>
      ) : null}
    </div>
  );
}
