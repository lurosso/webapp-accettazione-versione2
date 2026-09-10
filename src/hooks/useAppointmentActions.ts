'use client';

// Azioni rapide sulla pratica con mutazioni pessimistiche: il pulsante attende la risposta del
// server e la coda viene ricaricata. 409 VERSION_CONFLICT → dialog con la pratica aggiornata;
// 409 BAY_BUSY → scelta fra le campate libere; altri errori → messaggio, mai blocco della UI.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Appointment } from '@/domain/entities/appointment';
import { ApiError, postAppointmentAction } from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import type { AppointmentActionRequest } from '@/modules/reception/types';

export interface FreeBayOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Esito da mostrare all'operatore quando un'azione non va a buon fine. */
export type ActionOutcome =
  | {
      readonly kind: 'version-conflict';
      readonly message: string;
      readonly current: Appointment | null;
    }
  | {
      readonly kind: 'bay-busy';
      readonly message: string;
      readonly appointmentId: string;
      readonly expectedVersion: number;
      readonly freeBays: readonly FreeBayOption[];
    }
  | { readonly kind: 'error'; readonly message: string };

interface Variables {
  readonly appointmentId: string;
  readonly body: AppointmentActionRequest;
}

function isAppointment(v: unknown): v is Appointment {
  return typeof v === 'object' && v !== null && 'id' in v && 'code' in v && 'status' in v;
}

function isFreeBayList(v: unknown): v is FreeBayOption[] {
  return (
    Array.isArray(v) &&
    v.every(
      (b) =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as FreeBayOption).id === 'string' &&
        typeof (b as FreeBayOption).code === 'string',
    )
  );
}

function toOutcome(error: unknown, variables: Variables): ActionOutcome {
  if (error instanceof ApiError) {
    if (error.code === 'VERSION_CONFLICT') {
      const current = error.details?.['current'];
      return {
        kind: 'version-conflict',
        message: error.message,
        current: isAppointment(current) ? current : null,
      };
    }
    if (error.code === 'BAY_BUSY') {
      const freeBays = error.details?.['freeBays'];
      return {
        kind: 'bay-busy',
        message: error.message,
        appointmentId: variables.appointmentId,
        expectedVersion: variables.body.expectedVersion,
        freeBays: isFreeBayList(freeBays) ? freeBays : [],
      };
    }
    return { kind: 'error', message: error.message };
  }
  return {
    kind: 'error',
    message: 'Il server non ha risposto in tempo. La coda verrà ricaricata: riprovare.',
  };
}

export function useAppointmentActions() {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const mutation = useMutation({
    mutationFn: ({ appointmentId, body }: Variables) => postAppointmentAction(appointmentId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queueKeys.all });
    },
    onError: async (error, variables) => {
      setOutcome(toOutcome(error, variables));
      await queryClient.invalidateQueries({ queryKey: queueKeys.all });
    },
  });

  const run = useCallback(
    (appointmentId: string, body: AppointmentActionRequest): void => {
      setOutcome(null);
      mutation.mutate({ appointmentId, body });
    },
    [mutation],
  );

  const clearOutcome = useCallback(() => setOutcome(null), []);

  return {
    run,
    /** Id della pratica su cui è in corso un'azione (per disabilitare i suoi pulsanti). */
    pendingId: mutation.isPending ? mutation.variables.appointmentId : null,
    outcome,
    clearOutcome,
  };
}
