'use client';

// «Sono in ritardo»: un tocco avvisa l'accettazione (avviso ambra in dashboard, arrivo atteso
// spostato di CUSTOMER_LATE_NOTICE_MINUTES) senza telefonare; la risposta aggiorna subito la
// schermata. Dopo l'avviso il pulsante lascia il posto a una sola riga di conferma, con l'ora a
// cui lo aspettiamo. Le stesse parole del pulsante WhatsApp, senza spiegazioni sotto (M8-T56).
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

  // Chi ha già detto «Sono qui» non è in ritardo: né pulsante né conferma, una cosa in meno.
  if (position.arrivedAt !== null) {
    return null;
  }
  if (position.lateNotice !== null && !position.canReportDelay) {
    return (
      <p role="status" className="text-status-in-progress-ink text-xl font-semibold">
        <span aria-hidden="true">✓ </span>
        Ritardo segnalato: la aspettiamo verso le{' '}
        <strong className="font-mono">
          {localTimeHHmm(new Date(position.lateNotice.etaAt), timeZone)}
        </strong>
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
        ? "Non è andato a buon fine. Riprovi o chiami l'accettazione."
        : null;

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        data-testid="sono-in-ritardo"
        className="border-status-in-progress bg-status-in-progress-soft text-status-in-progress-ink premibile focus-anello flex min-h-16 w-full items-center justify-center rounded-2xl border-2 px-5 text-2xl font-bold shadow-sm disabled:opacity-60"
      >
        {mutation.isPending ? 'Un istante…' : 'Sono in ritardo'}
      </button>
      {errore !== null ? (
        <p role="alert" className="text-status-no-show-ink text-lg font-semibold">
          {errore}
        </p>
      ) : null}
    </div>
  );
}
