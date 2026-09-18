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
        Il suo arrivo è registrato dalle{' '}
        <strong className="font-mono">
          {localTimeHHmm(new Date(position.arrivedAt), timeZone)}
        </strong>
        . Resti pure in auto: la chiamiamo noi.
      </p>
    );
  }
  if (!canAnnounceArrival(position)) {
    return null;
  }

  const errore =
    mutation.error instanceof ApiError
      ? mutation.error.status === 429
        ? 'Ha già avvisato da poco: riprovi fra qualche minuto.'
        : mutation.error.message
      : mutation.isError
        ? 'Non siamo riusciti a registrare l’arrivo. Riprovi o si rivolga allo sportello.'
        : null;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        data-testid="sono-arrivato"
        className="bg-brand-secondary active:bg-brand-blue-dark controllo-lg premibile focus-anello flex w-full items-center justify-center rounded-2xl px-5 text-xl font-bold text-white shadow-sm disabled:opacity-60"
      >
        {mutation.isPending ? 'Un istante…' : 'Sono qui, sono in fila'}
      </button>
      <p className="text-center text-sm text-slate-500">
        Lo tocchi quando è in fila davanti all&apos;officina: l&apos;accettazione saprà che
        c&apos;è. Il suo turno non cambia.
      </p>
      {errore !== null ? (
        <p role="alert" className="text-status-no-show-ink text-center text-sm font-semibold">
          {errore}
        </p>
      ) : null}
    </div>
  );
}
