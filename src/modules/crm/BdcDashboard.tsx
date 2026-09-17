'use client';

// Cruscotto del BDC (modulo F): la lista di lavoro del back office.
// Chi non si presenta in officina finisce qui entro pochi secondi, con nome, telefono e veicolo;
// il reparto telefona, riprogramma l'appuntamento su Infinity e chiude la riga.
//
// Nient'altro: niente statistiche, niente medie, niente grafici. Dal 2026-09-17 gli indicatori
// della giornata stanno nella vista amministratore; qui resta l'elenco degli assenti, che è il
// lavoro del BDC. Dal 2026-09-17 anche la chiusura di giornata è altrove (vista Amministrazione):
// è un atto di supervisione, e chi telefona ai clienti assenti quella lista se la ritrova fatta.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@/application/auth/IAuthService';
import type { BdcLeadView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Button } from '@/components/ui/button';
import { ApiError, postLeadContacted, postLeadReopen } from '@/lib/api-client/client';
import { bdcKeys, useBdcLeads, BDC_POLLING_MS } from '@/hooks/useBdcLeads';
import { BdcLeadsTable } from './BdcLeadsTable';
import { TableSkeleton } from '@/components/ui/skeleton';

export interface BdcDashboardProps {
  readonly session: Session;
  /** Giornata operativa del server: evita di fidarsi dell'orologio del browser. */
  readonly businessDate: string;
  readonly timeZone: string;
}

export function BdcDashboard({ session, businessDate, timeZone }: BdcDashboardProps) {
  const [giornataCorrente, setGiornataCorrente] = useState(true);
  const [mostraChiusi, setMostraChiusi] = useState(false);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const params = {
    businessDate: giornataCorrente ? businessDate : null,
    includeHandled: mostraChiusi,
  };
  const query = useBdcLeads(params);
  const queryClient = useQueryClient();

  /** Riporta un lead chiuso fra quelli da fare: tocco sbagliato o riprogrammazione saltata. */
  const onReopen = async (lead: BdcLeadView): Promise<void> => {
    setErrore(null);
    setInCorso(lead.eventId);
    try {
      await postLeadReopen(lead.eventId);
      await queryClient.invalidateQueries({ queryKey: bdcKeys.all });
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : 'Non è stato possibile riaprire il lead: riprova fra poco.',
      );
    } finally {
      setInCorso(null);
    }
  };

  const onContacted = async (lead: BdcLeadView, note: string | null): Promise<void> => {
    setErrore(null);
    setInCorso(lead.eventId);
    try {
      await postLeadContacted(lead.eventId, note);
      await queryClient.invalidateQueries({ queryKey: bdcKeys.all });
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : 'Non è stato possibile registrare il ricontatto: riprova fra poco.',
      );
    } finally {
      setInCorso(null);
    }
  };

  const data = query.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cruscotto BDC</h1>
          <p className="text-sm text-slate-600">
            Clienti che non si sono presentati in officina, da ricontattare e riprogrammare su
            Infinity. L&apos;elenco si aggiorna da solo ogni {Math.round(BDC_POLLING_MS / 1000)}{' '}
            secondi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={data !== undefined && data.openCount > 0 ? 'warning' : 'success'}>
            {data === undefined
              ? '—'
              : data.openCount === 1
                ? '1 da ricontattare'
                : `${data.openCount} da ricontattare`}
          </Badge>
          <Badge tone="neutral">
            {data === undefined
              ? '—'
              : data.handledCount === 1
                ? '1 già gestito'
                : `${data.handledCount} già gestiti`}
          </Badge>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={giornataCorrente ? 'default' : 'outline'}
          size="touch"
          onClick={() => setGiornataCorrente(true)}
        >
          Oggi
        </Button>
        <Button
          variant={giornataCorrente ? 'outline' : 'default'}
          size="touch"
          onClick={() => setGiornataCorrente(false)}
        >
          Tutte le giornate
        </Button>
        <label className="controllo text-ink-soft ml-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mostraChiusi}
            onChange={(event) => setMostraChiusi(event.target.checked)}
            className="size-6 rounded border-slate-300 accent-[#0065a0]"
          />
          Mostra anche i già gestiti
        </label>
        <span className="ml-auto text-xs text-slate-500">Operatore BDC: {session.displayName}</span>
      </div>

      {errore !== null ? <Notice tone="error">{errore}</Notice> : null}
      {query.isError ? (
        <Notice tone="warning">
          Elenco non aggiornato: il server non risponde. I lead già a schermo restano validi.
        </Notice>
      ) : null}

      {query.isPending ? (
        <TableSkeleton rows={4} columns={7} label="Caricamento dei lead" />
      ) : (
        <BdcLeadsTable
          leads={data?.leads ?? []}
          timeZone={timeZone}
          pendingId={inCorso}
          onContacted={(lead, note) => {
            void onContacted(lead, note);
          }}
          onReopen={(lead) => {
            void onReopen(lead);
          }}
        />
      )}

      <p className="text-ink-muted text-xs">
        I lead nascono dagli eventi inviati al CRM quando un accettatore segna un cliente assente.
        &ldquo;Segna come ricontattato&rdquo; chiude la riga anche se il CRM non è raggiungibile: il
        lavoro del BDC resta registrato e l&apos;evento viene rinviato per conto suo.
      </p>
    </div>
  );
}
