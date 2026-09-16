'use client';

// "Sto arrivando in ritardo (+10 min)": l'unica azione del cliente dal telefono. Un tocco avvisa
// l'accettazione (avviso ambra in dashboard) senza telefonare; la risposta aggiorna subito la
// schermata. Dopo l'avviso il pulsante lascia il posto alla conferma.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CUSTOMER_LATE_NOTICE_MINUTES } from '@/config/constants';
import type { PortalStatusView } from '@/domain/read-models';
import { publicStatusKeys } from '@/hooks/usePublicStatus';
import { ApiError, postPublicLateNotice } from '@/lib/api-client/client';
import { localTimeHHmm } from '@/lib/dates';
import type { PublicStatus } from './types';

export interface LateNoticeButtonProps {
  readonly position: PortalStatusView;
  readonly targa: string;
  readonly token: string | null;
  readonly timeZone: string;
}

export function LateNoticeButton({ position, targa, token, timeZone }: LateNoticeButtonProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => postPublicLateNotice({ targa: targa === '' ? position.plate : targa, token }),
    onSuccess: (data: PublicStatus) => {
      queryClient.setQueryData(publicStatusKeys.byLookup(targa, token), data);
    },
  });

  if (position.lateNotice !== null && !position.canReportDelay) {
    return (
      <p
        role="status"
        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-center text-base text-amber-900"
      >
        Hai avvisato che arrivi in ritardo: ti aspettiamo verso le{' '}
        <strong>{localTimeHHmm(new Date(position.lateNotice.etaAt), timeZone)}</strong>. Il tuo
        codice <strong>{position.code}</strong> resta valido.
      </p>
    );
  }
  if (!position.canReportDelay) {
    return null;
  }

  const errore =
    mutation.error instanceof ApiError
      ? mutation.error.status === 429
        ? 'Hai già avvisato da poco: riprova fra qualche minuto.'
        : mutation.error.message
      : mutation.isError
        ? 'Non siamo riusciti a inviare l’avviso. Riprova o chiama lo sportello.'
        : null;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="h-touch flex w-full items-center justify-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-5 text-lg font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 focus-visible:ring-4 focus-visible:ring-amber-300 focus-visible:outline-none disabled:opacity-60"
      >
        <span aria-hidden="true">⏱</span>
        {mutation.isPending
          ? 'Invio dell’avviso…'
          : `Sto arrivando in ritardo (+${CUSTOMER_LATE_NOTICE_MINUTES} min)`}
      </button>
      <p className="text-center text-sm text-slate-500">
        Avvisi l&apos;accettazione con un tocco, senza telefonare. Il tuo codice non cambia.
      </p>
      {errore !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-800">
          {errore}
        </p>
      ) : null}
    </div>
  );
}
