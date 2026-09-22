'use client';

// «Segnalazioni & alert di sistema»: quello che il personale ha segnalato dalla pagina Sistema,
// dalla più recente, con lo stato in cui l'amministratore la sta portando. Si aggiorna da sola
// (evento `SYSTEM_ALERT_CHANGED` sul flusso, polling di riserva): una segnalazione fatta al banco
// compare qui senza ricaricare.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  SYSTEM_ALERT_COMPONENT_LABELS,
  SYSTEM_ALERT_STATUS_LABELS,
  type SystemAlert,
  type SystemAlertStatus,
} from '@/domain/entities/system-alert';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import { ApiError, fetchSystemAlerts, patchSystemAlert } from '@/lib/api-client/client';
import { formatDateTimeIt } from '@/lib/dates';

export interface SystemAlertsPanelProps {
  readonly timeZone: string;
}

const STATUS_TONES: Readonly<Record<SystemAlertStatus, BadgeTone>> = {
  NEW: 'danger',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
};

/** Chiave della query: la condividono il pannello e il contatore sulla scheda. */
export const systemAlertsKey = (includeResolved: boolean) =>
  ['system-alerts', includeResolved ? 'tutte' : 'aperte'] as const;

export function SystemAlertsPanel({ timeZone }: SystemAlertsPanelProps) {
  const queryClient = useQueryClient();
  const [mostraRisolte, setMostraRisolte] = useState(false);
  const alerts = useQuery({
    queryKey: systemAlertsKey(mostraRisolte),
    queryFn: () => fetchSystemAlerts(mostraRisolte),
    refetchInterval: 15_000,
  });
  useLiveUpdates({
    url: '/api/v1/events/stream',
    types: ['SYSTEM_ALERT_CHANGED'],
    invalidate: [['system-alerts']],
  });
  const cambia = useMutation({
    mutationFn: (input: { id: string; status: SystemAlertStatus }) =>
      patchSystemAlert(input.id, { status: input.status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['system-alerts'] }),
  });
  const errore =
    cambia.error instanceof ApiError
      ? cambia.error.message
      : cambia.isError
        ? 'Aggiornamento non riuscito: riprova.'
        : null;

  const azioni = (a: SystemAlert) => {
    const bottone = (
      status: SystemAlertStatus,
      etichetta: string,
      variant: 'default' | 'outline',
    ) => (
      <Button
        key={status}
        size="sm"
        variant={variant}
        disabled={cambia.isPending}
        data-testid={`alert-${a.id}-${status}`}
        onClick={() => cambia.mutate({ id: a.id, status })}
      >
        {etichetta}
      </Button>
    );
    switch (a.status) {
      case 'NEW':
        return [
          bottone('IN_PROGRESS', 'Prendi in gestione', 'default'),
          bottone('RESOLVED', 'Risolta', 'outline'),
        ];
      case 'IN_PROGRESS':
        return [
          bottone('RESOLVED', 'Risolta', 'default'),
          bottone('NEW', 'Rimetti fra le nuove', 'outline'),
        ];
      case 'RESOLVED':
        return [bottone('NEW', 'Riapri', 'outline')];
    }
  };

  const nuove = alerts.data?.summary.new ?? 0;
  const inGestione = alerts.data?.summary.inProgress ?? 0;

  return (
    <Panel data-testid="pannello-segnalazioni">
      <PanelHeader
        title="Segnalazioni & alert di sistema"
        description="Quello che il personale ha segnalato dalla pagina Sistema: codice del controllo, chi e da dove. Prendile in gestione e chiudile quando è risolto."
        meta={
          alerts.data !== undefined ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={nuove > 0 ? 'danger' : 'neutral'} data-testid="segnalazioni-nuove">
                {nuove} {nuove === 1 ? 'nuova' : 'nuove'}
              </Badge>
              <Badge tone={inGestione > 0 ? 'warning' : 'neutral'}>{inGestione} in gestione</Badge>
              <Badge tone="neutral">
                {alerts.data.summary.resolved}{' '}
                {alerts.data.summary.resolved === 1 ? 'risolta' : 'risolte'}
              </Badge>
            </span>
          ) : null
        }
        actions={
          <Switch
            checked={mostraRisolte}
            onChange={setMostraRisolte}
            label="Mostra anche le risolte"
            testId="segnalazioni-mostra-risolte"
          />
        }
      />
      {errore !== null ? <Notice tone="error">{errore}</Notice> : null}
      {alerts.isPending ? (
        <TableSkeleton rows={3} columns={4} label="Caricamento delle segnalazioni" />
      ) : alerts.isError ? (
        <Notice tone="error">Segnalazioni non disponibili in questo momento.</Notice>
      ) : alerts.data.alerts.length === 0 ? (
        <EmptyState
          title={mostraRisolte ? 'Nessuna segnalazione' : 'Nessuna segnalazione aperta'}
          description="Quando qualcuno tocca «Segnala ad Admin» nella pagina Sistema, compare qui in tempo reale."
        />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="segnalazioni-elenco">
          {alerts.data.alerts.map((a) => (
            <li
              key={a.id}
              className="border-line bg-surface flex flex-wrap items-start gap-x-4 gap-y-2 rounded-xl border p-4"
              data-testid={`segnalazione-${a.code}`}
              data-stato={a.status}
            >
              <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONES[a.status]}>
                    {SYSTEM_ALERT_STATUS_LABELS[a.status]}
                  </Badge>
                  <span className="testo-nota font-mono font-semibold">{a.code}</span>
                  <span className="testo-nota text-ink-soft">
                    {SYSTEM_ALERT_COMPONENT_LABELS[a.component]}
                  </span>
                </span>
                <span className="testo-corpo">{a.message}</span>
                <span className="text-ink-muted testo-nota">
                  {formatDateTimeIt(a.createdAt, timeZone)} · {a.reportedByName}
                  {a.workstationName !== null ? ` · ${a.workstationName}` : ''}
                  {a.handledByName !== null ? ` · gestita da ${a.handledByName}` : ''}
                  {a.resolvedAt !== null
                    ? ` · risolta ${formatDateTimeIt(a.resolvedAt, timeZone)}`
                    : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">{azioni(a)}</div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
