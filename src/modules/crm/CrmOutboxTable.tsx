'use client';

// Coda di uscita verso il CRM, vista dal tecnico (modulo F).
// Risponde a una domanda sola: il CRM sta ricevendo? Per questo mostra stato, tentativi e ultimo
// errore per esteso, senza addolcire nulla, e lascia forzare un nuovo tentativo quando il CRM
// torna raggiungibile prima del giro automatico.
import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrmOutboxRowView } from '@/domain/read-models';
import type { CrmOutboxStatus } from '@/domain/entities/crm-outbox-event';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, fetchCrmOutbox, postOutboxRetry } from '@/lib/api-client/client';
import { formatDateTimeIt, localTimeHHmm } from '@/lib/dates';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';

export interface CrmOutboxTableProps {
  readonly timeZone: string;
}

const STATO_ETICHETTE: Record<CrmOutboxStatus, string> = {
  PENDING: 'In attesa di invio',
  SENT: 'Inviato',
  FAILED: 'Non riuscito',
  MANUAL: 'Chiuso a mano dal BDC',
};

const STATO_TONI: Record<CrmOutboxStatus, BadgeTone> = {
  PENDING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  MANUAL: 'neutral',
};

const TIPO_ETICHETTE: Record<string, string> = {
  NO_SHOW: 'Cliente assente',
  CHECK_IN: 'Accettazione conclusa',
  ANOMALY: 'Anomalia di flusso',
};

/** La coda cambia di rado: si aggiorna ogni 15 s, non serve il ritmo della dashboard. */
const OUTBOX_POLLING_MS = 15_000;

export function CrmOutboxTable({ timeZone }: CrmOutboxTableProps) {
  const [soloDaRisolvere, setSoloDaRisolvere] = useState(false);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['crm-outbox', soloDaRisolvere] as const,
    queryFn: () => fetchCrmOutbox(soloDaRisolvere ? ['PENDING', 'FAILED'] : []),
    refetchInterval: OUTBOX_POLLING_MS,
    placeholderData: keepPreviousData,
  });

  const riprova = async (row: CrmOutboxRowView): Promise<void> => {
    setInCorso(row.eventId);
    setMessaggio(null);
    setErrore(null);
    try {
      const esito = await postOutboxRetry(row.eventId);
      setMessaggio(
        esito.outcome === 'SENT'
          ? `Evento ${row.code ?? row.eventId} consegnato al CRM.`
          : esito.outcome === 'ALREADY_SENT'
            ? `Evento ${row.code ?? row.eventId} già consegnato in precedenza.`
            : `Il CRM non ha accettato l'evento ${row.code ?? row.eventId}: resta in coda.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['crm-outbox'] });
    } catch (cause) {
      setErrore(cause instanceof ApiError ? cause.message : 'Riprova non riuscita.');
    } finally {
      setInCorso(null);
    }
  };

  const view = query.data ?? null;
  const rows = view?.rows ?? [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Coda di uscita verso il CRM</h2>
          <p className="text-sm text-slate-600">
            Eventi inviati al CRM/BDC: assenze e accettazioni concluse. Un evento non consegnato
            viene ritentato da solo con attesa progressiva, poi resta qui in attesa di una
            decisione.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view !== null ? (
            <>
              <Badge tone="warning">{view.counts.pending} in attesa</Badge>
              <Badge tone="danger">{view.counts.failed} non riusciti</Badge>
              <Badge tone="success">{view.counts.sent} inviati</Badge>
            </>
          ) : null}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="controllo text-ink-soft flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={soloDaRisolvere}
            onChange={(event) => setSoloDaRisolvere(event.target.checked)}
            className="size-6 rounded border-slate-300 accent-[#0065a0]"
          />
          Mostra solo quelli da risolvere
        </label>
        <Button variant="outline" size="touch" onClick={() => void query.refetch()}>
          Aggiorna
        </Button>
      </div>

      {errore !== null || query.isError ? (
        <Notice tone="error" className="mb-3">
          {errore ?? 'Coda non leggibile in questo momento: riprova fra qualche istante.'}
        </Notice>
      ) : null}
      {messaggio !== null ? (
        <p role="status" className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-800">
          {messaggio}
        </p>
      ) : null}

      {query.isPending ? (
        <TableSkeleton rows={4} columns={7} label="Caricamento della coda" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nessun evento in coda"
          description={
            soloDaRisolvere
              ? 'Niente da risolvere: ogni evento è stato consegnato o chiuso a mano.'
              : 'Il primo evento comparirà quando un cliente verrà segnato assente o un check-in verrà concluso.'
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pt-3">Data/ora</TableHead>
              <TableHead className="pt-3">Evento</TableHead>
              <TableHead className="pt-3">Pratica</TableHead>
              <TableHead className="pt-3">Stato</TableHead>
              <TableHead className="pt-3">Tentativi</TableHead>
              <TableHead className="pt-3">Ultimo errore</TableHead>
              <TableHead className="pt-3">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.eventId}>
                <TableCell className="font-mono whitespace-nowrap tabular-nums">
                  {formatDateTimeIt(row.createdAt, timeZone)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {TIPO_ETICHETTE[row.type] ?? row.type}
                  <span className="text-ink-muted block font-mono text-xs">{row.type}</span>
                </TableCell>
                <TableCell className="font-mono font-semibold whitespace-nowrap">
                  {row.code ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge tone={STATO_TONI[row.status]}>{STATO_ETICHETTE[row.status]}</Badge>
                  {row.sentAt !== null ? (
                    <span className="mt-1 block text-xs text-slate-500">
                      inviato alle {localTimeHHmm(new Date(row.sentAt), timeZone)}
                      {row.crmAckId === null ? '' : ` · ricevuta ${row.crmAckId}`}
                    </span>
                  ) : row.nextAttemptAt !== null ? (
                    <span className="mt-1 block text-xs text-slate-500">
                      prossimo tentativo alle {localTimeHHmm(new Date(row.nextAttemptAt), timeZone)}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-center tabular-nums">{row.attemptCount}</TableCell>
                <TableCell className="max-w-xs">
                  {row.lastError === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    <span className="text-status-no-show-ink block font-mono text-xs break-words">
                      {row.lastError}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {row.status === 'SENT' ? (
                    <span className="text-ink-muted text-xs">—</span>
                  ) : (
                    <Button
                      size="touch"
                      variant="outline"
                      disabled={inCorso === row.eventId}
                      onClick={() => void riprova(row)}
                    >
                      {inCorso === row.eventId ? 'Invio…' : 'Forza riprova'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
