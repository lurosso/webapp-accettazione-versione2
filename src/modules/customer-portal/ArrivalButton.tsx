'use client';

// «Sono qui»: il cliente dichiara di essere in officina dalla pagina di tracciamento, senza
// passare da WhatsApp. È il gesto che chiude il cerchio anche quando la messaggistica è in pausa.
//
// Il pulsante vive solo finché serve: appena l'ora è registrata sparisce e al suo posto resta una
// riga di conferma. Un secondo tocco a schermo non può succedere — il pulsante non c'è più — e un
// secondo tocco dal telefono di qualcun altro, o da WhatsApp, non sposta l'ora già presa: lo
// garantisce il servizio, non questa schermata.
//
// «Sono qui» e non «Sono arrivato»: la parola non deve scegliere un genere (vedi status-messages).
// Nessuna spiegazione sotto il pulsante (M8-T56): la parola basta, e ogni riga in più è una riga
// che una persona anziana deve leggere prima di capire cosa toccare.
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
    // La conferma serve mentre si aspetta; quando tocca a lui conta solo lo sportello.
    if (position.queuePosition === null) {
      return null;
    }
    return (
      <p role="status" data-testid="arrivo-registrato" className="text-ink text-xl font-semibold">
        <span aria-hidden="true">✓ </span>
        Arrivo registrato alle{' '}
        <strong className="font-mono">
          {localTimeHHmm(new Date(position.arrivedAt), timeZone)}
        </strong>
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
        ? "Non è andato a buon fine. Riprovi o si rivolga all'accettazione."
        : null;

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        data-testid="sono-arrivato"
        className="bg-brand-secondary active:bg-brand-blue-dark premibile focus-anello flex min-h-16 w-full items-center justify-center rounded-2xl px-5 text-2xl font-bold text-white shadow-sm disabled:opacity-60"
      >
        {mutation.isPending ? 'Un istante…' : 'Sono qui'}
      </button>
      {errore !== null ? (
        <p role="alert" className="text-status-no-show-ink text-lg font-semibold">
          {errore}
        </p>
      ) : null}
    </div>
  );
}
