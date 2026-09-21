'use client';

// Chiusura della giornata operativa, nella vista di amministrazione.
//
// È l'azione più distruttiva dell'applicazione: chi era ancora in coda diventa assente (e finisce
// nel cruscotto BDC con l'evento verso il CRM), chi era ancora in carico viene chiuso d'ufficio.
// Per questo dal 2026-09-17 sta qui, accanto alle statistiche e al report della giornata, e non
// più nel cruscotto BDC: chiudere la giornata è un atto di supervisione, non il lavoro di chi
// telefona ai clienti assenti, che quella lista se la ritrova davanti già fatta.
//
// Due passaggi obbligati, come prima: un pulsante rosso e una conferma che elenca per iscritto
// cosa succede. Nessuno deve scoprire dopo che cosa ha premuto.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Dialog } from '@/components/ui/dialog';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { bdcKeys } from '@/hooks/useBdcLeads';
import { ApiError, postCloseDay } from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';

export interface CloseDayPanelProps {
  /** Giornata operativa del server: è quella che si chiude. */
  readonly businessDate: string;
}

export function CloseDayPanel({ businessDate }: CloseDayPanelProps) {
  const [conferma, setConferma] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const chiudiGiornata = async (): Promise<void> => {
    setInCorso(true);
    setErrore(null);
    try {
      const r = await postCloseDay();
      const parti = [
        r.noShow.length === 1
          ? '1 cliente segnato assente'
          : `${r.noShow.length} clienti segnati assenti`,
        r.autoClosed.length === 1
          ? "1 accettazione ancora in carico chiusa d'ufficio (da confermare)"
          : `${r.autoClosed.length} accettazioni ancora in carico chiuse d'ufficio (da confermare)`,
      ];
      if (r.failed.length > 0) {
        parti.push(`${r.failed.length} pratiche non chiuse (${r.failed.join(', ')}): riprova`);
      }
      setEsito(`Giornata ${r.businessDate} chiusa: ${parti.join(', ')}.`);
      setConferma(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bdcKeys.all }),
        queryClient.invalidateQueries({ queryKey: queueKeys.all }),
      ]);
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : 'Non è stato possibile chiudere la giornata: riprova.',
      );
      setConferma(false);
    } finally {
      setInCorso(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="Chiusura della giornata"
        description={`A officina chiusa non deve restare nulla di aperto. Si esegue a fine turno, sulla giornata ${businessDate}; di norma ci pensa il sistema alla chiusura automatica.`}
        actions={
          <Button
            variant="destructive"
            onClick={() => setConferma(true)}
            disabled={inCorso}
            data-testid="chiudi-giornata"
          >
            {inCorso ? 'Chiusura in corso…' : 'Esegui chiusura giornata'}
          </Button>
        }
      />

      {esito !== null ? (
        <Notice tone="success" className="mt-3">
          {esito}
        </Notice>
      ) : null}
      {errore !== null ? (
        <Notice tone="error" className="mt-3">
          {errore}
        </Notice>
      ) : null}

      <Dialog
        open={conferma}
        title="Chiudere la giornata?"
        description="Operazione di fine turno: non si annulla."
        onClose={() => setConferma(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setConferma(false)}>
              Annulla
            </Button>
            <Button
              variant="destructive"
              onClick={() => void chiudiGiornata()}
              disabled={inCorso}
              data-testid="conferma-chiusura"
            >
              {inCorso ? 'Chiusura in corso…' : 'Sì, chiudi la giornata'}
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-slate-700">
          <li>
            I clienti ancora <strong>in coda</strong> vengono segnati <strong>assenti</strong> e
            compaiono nel cruscotto BDC come lead da ricontattare, con l&apos;evento verso il CRM.
          </li>
          <li>
            Le accettazioni ancora <strong>in carico</strong> vengono chiuse d&apos;ufficio: non
            sono state concluse e non possono restare aperte fino a domani.
          </li>
          <li>Monitor e tabellone si svuotano: nessun codice chiamato, sportelli liberi.</li>
          <li>Le pratiche già completate o già chiuse non vengono toccate.</li>
        </ul>
      </Dialog>
    </Panel>
  );
}
