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
        className="border-status-in-progress/40 bg-status-in-progress-soft text-status-in-progress-ink rounded-xl border px-4 py-3 text-center text-base"
      >
        Il ritardo è stato segnalato: la aspettiamo verso le{' '}
        <strong>{localTimeHHmm(new Date(position.lateNotice.etaAt), timeZone)}</strong>. Il suo
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
        ? 'Ha già avvisato da poco: riprovi fra qualche minuto.'
        : mutation.error.message
      : mutation.isError
        ? 'Non siamo riusciti a inviare l’avviso. Riprovi o chiami lo sportello.'
        : null;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="h-touch border-status-in-progress bg-status-in-progress-soft text-status-in-progress-ink hover:bg-status-in-progress-soft focus-visible:ring-status-in-progress/50 flex w-full items-center justify-center gap-2 rounded-xl border-2 px-5 text-lg font-semibold shadow-sm transition-colors focus-visible:ring-4 focus-visible:outline-none disabled:opacity-60"
      >
        <span aria-hidden="true">⏱</span>
        {mutation.isPending
          ? 'Invio dell’avviso…'
          : `Sto arrivando in ritardo (+${CUSTOMER_LATE_NOTICE_MINUTES} min)`}
      </button>
      <p className="text-center text-sm text-slate-500">
        Avvisa l&apos;accettazione con un tocco, senza telefonare. Il suo codice non cambia.
      </p>
      {errore !== null ? (
        <p
          role="alert"
          className="bg-status-no-show-soft text-status-no-show-ink rounded-lg px-3 py-2 text-center text-sm"
        >
          {errore}
        </p>
      ) : null}
    </div>
  );
}
