'use client';

// «Segnala un problema»: il ticket che l'accettatore manda all'amministratore quando qualcosa non va.
//
// Dal 2026-09-24 è l'unica cosa che l'accettatore trova in Sistema. Lo stato delle porte, i codici
// dei controlli, la coda verso il CRM sono strumenti dell'amministratore: al banco non servono a
// lavorare e non dicono cosa fare. Qui si sceglie di cosa si tratta con parole di tutti i giorni e
// si scrive cosa succede; chi sei e da quale postazione lo aggiunge il sistema, e l'amministratore
// vede la segnalazione arrivare nel suo pannello in tempo reale.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import {
  SYSTEM_ALERT_COMPONENT_LABELS,
  SYSTEM_ALERT_COMPONENTS,
  type SystemAlertComponent,
} from '@/domain/entities/system-alert';
import { ApiError, postSystemAlert } from '@/lib/api-client/client';

/** Le categorie come le direbbe chi sta al banco, nell'ordine in cui capitano più spesso. */
const CATEGORIE_BANCO: readonly { readonly value: SystemAlertComponent; readonly label: string }[] =
  [
    { value: 'HARDWARE', label: 'Stampante, tablet o PC' },
    { value: 'NETWORK', label: 'Internet / rete che non va' },
    { value: 'INFINITY', label: 'Appuntamenti che mancano o sono sbagliati' },
    { value: 'SPOKI', label: 'Messaggi WhatsApp ai clienti' },
    { value: 'MEDIA_STORAGE', label: 'Foto e video del check-in' },
    { value: 'OTHER', label: 'Altro' },
  ];

export interface ProblemReportFormProps {
  /**
   * `banco`: categorie in parole semplici (la pagina dell'accettatore); `tecnico`: tutti i
   * componenti con il loro nome (la pagina dell'amministratore, sotto la diagnostica).
   */
  readonly variante?: 'banco' | 'tecnico';
}

export function ProblemReportForm({ variante = 'banco' }: ProblemReportFormProps) {
  const categorie =
    variante === 'banco'
      ? CATEGORIE_BANCO
      : SYSTEM_ALERT_COMPONENTS.map((c) => ({ value: c, label: SYSTEM_ALERT_COMPONENT_LABELS[c] }));
  const [componente, setComponente] = useState<SystemAlertComponent>('HARDWARE');
  const [testo, setTesto] = useState('');
  const [inviata, setInviata] = useState<string | null>(null);

  const segnala = useMutation({
    mutationFn: (body: { code: string; component: SystemAlertComponent; message: string }) =>
      postSystemAlert(body),
    onSuccess: (r) => {
      setInviata(r.alert.code);
      setTesto('');
    },
  });
  const errore =
    segnala.error instanceof ApiError
      ? segnala.error.message
      : segnala.isError
        ? 'Segnalazione non inviata: controlla la connessione e riprova.'
        : null;
  const etichetta = categorie.find((c) => c.value === componente)?.label ?? componente;

  return (
    <Panel>
      <PanelHeader
        title={variante === 'banco' ? 'Segnala un problema' : 'Segnala un’altra disfunzione'}
        description={
          variante === 'banco'
            ? 'Qualcosa non funziona? Scegli di cosa si tratta e scrivi cosa succede: arriva subito all’amministratore, con il tuo nome e la postazione.'
            : 'Per quello che nessun controllo vede: stampanti, tablet, lettore del QR, cavi. Chi sei e da quale postazione lo aggiunge il sistema.'
        }
      />
      {inviata !== null ? (
        <Notice tone="success" data-testid="segnalazione-inviata">
          Segnalazione inviata all&apos;amministratore ({etichetta}). Codice{' '}
          <strong>{inviata}</strong>: se ti richiamano, è questo.
        </Notice>
      ) : null}
      {errore !== null ? <Notice tone="error">{errore}</Notice> : null}
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (testo.trim() === '') {
            return;
          }
          setInviata(null);
          segnala.mutate({
            code: `${componente}-MANUALE`,
            component: componente,
            message: testo.trim(),
          });
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex w-72 flex-col gap-1.5">
            <span className="testo-nota text-ink-soft font-semibold">Di cosa si tratta</span>
            <select
              value={componente}
              onChange={(event) => setComponente(event.target.value as SystemAlertComponent)}
              data-testid="segnalazione-componente"
              className="controllo border-line bg-surface text-ink testo-corpo focus-anello rounded-md border px-3"
            >
              {categorie.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
            <span className="testo-nota text-ink-soft font-semibold">Cosa succede</span>
            <textarea
              value={testo}
              onChange={(event) => setTesto(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="es. La stampante dello sportello B non stampa la ricevuta"
              data-testid="segnalazione-testo"
              className="border-line bg-surface text-ink testo-corpo focus-anello placeholder:text-ink-muted min-h-11 rounded-md border px-3 py-2"
            />
          </label>
          <Button
            type="submit"
            size="touch"
            disabled={segnala.isPending || testo.trim() === ''}
            data-testid="segnalazione-invia"
          >
            {segnala.isPending ? 'Invio…' : 'Invia all’amministratore'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
