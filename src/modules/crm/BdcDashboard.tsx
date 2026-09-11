'use client';

// Cruscotto del BDC (modulo F): la lista di lavoro del back office.
// Chi non si presenta in officina finisce qui entro pochi secondi, con nome, telefono e veicolo;
// il reparto telefona e chiude la riga. Nient'altro: una pagina di lavoro, non un cruscotto di
// indicatori, perché quello che serve al BDC è sapere chi chiamare adesso.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@/application/auth/IAuthService';
import type { BdcLeadView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, postLeadContacted } from '@/lib/api-client/client';
import { bdcKeys, useBdcLeads, BDC_POLLING_MS } from '@/hooks/useBdcLeads';
import { BdcLeadsTable } from './BdcLeadsTable';

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
            Clienti che non si sono presentati in officina, da ricontattare. L&apos;elenco si
            aggiorna da solo ogni {Math.round(BDC_POLLING_MS / 1000)} secondi.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                ? '1 già ricontattato'
                : `${data.handledCount} già ricontattati`}
          </Badge>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={giornataCorrente ? 'default' : 'outline'}
          size="sm"
          onClick={() => setGiornataCorrente(true)}
        >
          Oggi
        </Button>
        <Button
          variant={giornataCorrente ? 'outline' : 'default'}
          size="sm"
          onClick={() => setGiornataCorrente(false)}
        >
          Tutte le giornate
        </Button>
        <label className="ml-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={mostraChiusi}
            onChange={(event) => setMostraChiusi(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Mostra anche i già ricontattati
        </label>
        <span className="ml-auto text-xs text-slate-500">Operatore BDC: {session.displayName}</span>
      </div>

      {errore !== null ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {errore}
        </p>
      ) : null}
      {query.isError ? (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Elenco non aggiornato: il server non risponde. I lead già a schermo restano validi.
        </p>
      ) : null}

      {query.isPending ? (
        <p className="text-sm text-slate-500">Caricamento dei lead…</p>
      ) : (
        <BdcLeadsTable
          leads={data?.leads ?? []}
          timeZone={timeZone}
          pendingId={inCorso}
          onContacted={(lead, note) => {
            void onContacted(lead, note);
          }}
        />
      )}

      <p className="text-xs text-slate-400">
        I lead nascono dagli eventi inviati al CRM quando un accettatore segna un cliente assente.
        &ldquo;Segna come ricontattato&rdquo; chiude la riga anche se il CRM non è raggiungibile: il
        lavoro del BDC resta registrato e l&apos;evento viene rinviato per conto suo.
      </p>
    </div>
  );
}
