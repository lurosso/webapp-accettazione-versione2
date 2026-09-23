'use client';

// «Anomalie di oggi»: le pratiche su cui il flusso si è inceppato, dal lato dell'amministratore.
// Oggi è una sola regola — il cliente saltato tre volte al banco, da cercare — ma l'elenco è quello
// delle anomalie di flusso della coda di uscita, così le prossime (attesa troppo lunga, promemoria
// mai arrivato) compaiono qui senza un pannello nuovo.
//
// Le righe le lavora il BDC dal proprio cruscotto; qui si vede se sono state lavorate, da chi, e
// quelle che si sono chiuse da sole perché il cliente è stato poi preso in carico.
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { TableSkeleton } from '@/components/ui/skeleton';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import { fetchBdcLeads } from '@/lib/api-client/client';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';

export interface AnomaliesPanelProps {
  readonly businessDate: string;
  readonly timeZone: string;
}

export const anomaliesKey = (businessDate: string) => ['bdc-leads', 'anomalie', businessDate];

export function AnomaliesPanel({ businessDate, timeZone }: AnomaliesPanelProps) {
  const query = useQuery({
    queryKey: anomaliesKey(businessDate),
    queryFn: () => fetchBdcLeads({ businessDate, includeHandled: true, kind: 'anomalie' }),
    refetchInterval: 15_000,
  });
  useLiveUpdates({
    url: '/api/v1/events/stream',
    types: ['CRM_EVENT_CHANGED'],
    invalidate: [['bdc-leads']],
  });

  const data = query.data;
  const aperte = data?.openCount ?? 0;

  return (
    <Panel aria-label="Anomalie di oggi">
      <PanelHeader
        title="Anomalie di oggi"
        description="Pratiche su cui il flusso si è inceppato: oggi, i clienti saltati tre volte al banco, di cui verificare la presenza. Il BDC le lavora dal proprio cruscotto."
        meta={
          <Badge tone={aperte > 0 ? 'danger' : 'success'} dot>
            {data === undefined ? '—' : aperte === 1 ? '1 aperta' : `${aperte} aperte`}
          </Badge>
        }
      />
      {query.isError ? (
        <Notice tone="warning">Elenco non aggiornato: il server non risponde.</Notice>
      ) : null}
      {query.isPending ? (
        <TableSkeleton rows={2} columns={4} label="Caricamento delle anomalie" />
      ) : data === undefined || data.leads.length === 0 ? (
        <EmptyState
          title="Nessuna anomalia oggi"
          description="Nessuna pratica è stata saltata tre volte."
        />
      ) : (
        <ul className="divide-line-subtle flex flex-col divide-y">
          {data.leads.map((lead) => (
            <li
              key={lead.eventId}
              className={cn(
                'flex flex-wrap items-start justify-between gap-3 py-3',
                lead.handled && 'text-ink-muted',
              )}
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-ink testo-dato font-mono font-bold">
                    {lead.code ?? '—'}
                  </span>
                  <span className="text-ink testo-corpo font-semibold">
                    {lead.customerName ?? 'Cliente non più in agenda'}
                  </span>
                  {lead.plate !== null ? (
                    <span className="text-ink-soft testo-nota font-mono">{lead.plate}</span>
                  ) : null}
                </div>
                <span className="text-ink-soft testo-nota">
                  {lead.reason ?? 'Anomalia di flusso'} · alle{' '}
                  {localTimeHHmm(new Date(lead.detectedAt), timeZone)}
                </span>
                {lead.handled ? (
                  <span className="text-ink-muted testo-nota">
                    {lead.handledByName ?? 'Gestita'}
                    {lead.handledNote !== null ? ` · ${lead.handledNote}` : ''}
                  </span>
                ) : null}
              </div>
              <Badge tone={lead.handled ? 'success' : 'warning'}>
                {lead.handled ? 'Gestita' : 'Verificare presenza'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
