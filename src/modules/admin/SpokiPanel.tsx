'use client';

// Integrazione Spoki & messaggistica, per l'amministratore: com'è configurata, un invio di prova a
// un numero scelto a mano, il registro dei payload generati (in simulazione è l'unica traccia) e la
// guida per passare alle chiavi vere. Tutto in una sezione: chi entra qui vuole capire in un colpo
// d'occhio se i messaggi partono e cosa contengono.
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SpokiTestKind } from '@/application/messaging/SpokiDiagnosticsService';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ApiError, fetchSpokiOverview, postSpokiTest } from '@/lib/api-client/client';
import { formatDateTimeIt } from '@/lib/dates';

export interface SpokiPanelProps {
  readonly timeZone: string;
}

const KIND_LABELS: Record<SpokiTestKind, string> = {
  BOOKING_CONFIRMED: 'Conferma / inserimento manuale',
  TURN_APPROACHING: 'Turno in arrivo',
  APPOINTMENT_CANCELLED: 'Annullamento',
};

export function SpokiPanel({ timeZone }: SpokiPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-spoki'] as const,
    queryFn: fetchSpokiOverview,
    refetchInterval: 15_000,
  });
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<SpokiTestKind>('BOOKING_CONFIRMED');
  const [firstName, setFirstName] = useState('');
  const [invio, setInvio] = useState(false);
  const [esito, setEsito] = useState<{ tono: 'ok' | 'errore'; testo: string } | null>(null);

  const data = query.data;
  const simulazione = data?.mode === 'simulation';

  const inviaProva = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setEsito(null);
    setInvio(true);
    try {
      const r = await postSpokiTest({
        phone,
        kind,
        firstName: firstName.trim() === '' ? undefined : firstName.trim(),
      });
      setEsito({
        tono: 'ok',
        testo: `${simulazione ? 'Simulato' : 'Inviato'} (${r.templateKey}, id ${r.receipt.providerMessageId}): "${r.renderedText}"`,
      });
      await queryClient.invalidateQueries({ queryKey: ['admin-spoki'] });
    } catch (cause) {
      setEsito({
        tono: 'errore',
        testo: cause instanceof ApiError ? cause.message : 'Invio di prova non riuscito.',
      });
    } finally {
      setInvio(false);
    }
  };

  return (
    <section
      id="spoki"
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      aria-labelledby="spoki-titolo"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="spoki-titolo" className="text-lg font-semibold">
            Integrazione Spoki &amp; messaggistica
          </h2>
          <p className="text-sm text-slate-600">
            WhatsApp ai clienti: conferma con il codice, turno in arrivo, annullamento. In
            simulazione nessun messaggio parte davvero e nessun credito viene consumato: i payload
            finiscono nel registro qui sotto.
          </p>
        </div>
        {data !== undefined ? (
          <div className="flex flex-wrap gap-2">
            <Badge tone={data.provider === 'mock' ? 'neutral' : 'info'}>
              provider {data.provider}
            </Badge>
            <Badge tone={data.mode === 'simulation' ? 'warning' : 'success'}>
              {data.mode === 'simulation' ? 'SIMULAZIONE' : 'LIVE'}
            </Badge>
          </div>
        ) : null}
      </div>

      {query.isPending || data === undefined ? (
        <TableSkeleton rows={4} columns={3} label="Caricamento dello stato Spoki" />
      ) : (
        <div className="flex flex-col gap-6">
          {/* Configurazione */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Chiave API (SPOKI_API_KEY)
              </p>
              <p className="mt-1 font-mono text-sm">
                {data.apiKeyConfigured ? data.apiKeyMasked : 'non impostata'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Link al portale nei messaggi:{' '}
                <span className="font-mono">{data.publicBaseUrl}</span>
                /portal?targa=…
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Template (URL automazioni)
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {data.templates.map((t) => (
                  <li key={t.kind} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {KIND_LABELS[t.notificationKind]}{' '}
                      <span className="font-mono text-xs text-slate-500">{t.envKey}</span>
                    </span>
                    {t.configured ? (
                      <Badge tone="success" title={t.urlPreview ?? undefined}>
                        configurato
                      </Badge>
                    ) : (
                      <Badge tone={simulazione ? 'neutral' : 'warning'}>
                        {simulazione ? 'non serve in simulazione' : 'mancante'}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Invio di prova */}
          <form
            onSubmit={(e) => void inviaProva(e)}
            className="rounded-lg border border-slate-200 p-4"
            aria-label="Invio di prova"
          >
            <h3 className="text-sm font-bold text-slate-900">Messaggio di prova</h3>
            <p className="mt-0.5 mb-3 text-xs text-slate-500">
              Dati fittizi (pratica F999, targa AB123CD).{' '}
              {simulazione
                ? 'In simulazione finisce solo nel registro.'
                : 'ATTENZIONE: in modalità live parte un WhatsApp vero e consuma un credito.'}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="spoki-phone">Numero</Label>
                <Input
                  id="spoki-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+39 333 1234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="spoki-kind">Template</Label>
                <Select
                  id="spoki-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as SpokiTestKind)}
                >
                  {(Object.keys(KIND_LABELS) as SpokiTestKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="spoki-name">Nome nel messaggio</Label>
                <Input
                  id="spoki-name"
                  placeholder="Test"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={invio || phone.trim() === ''}>
                {invio ? 'Invio…' : simulazione ? 'Simula invio' : 'Invia messaggio di prova'}
              </Button>
              {esito !== null ? (
                <p
                  role={esito.tono === 'errore' ? 'alert' : 'status'}
                  className={
                    esito.tono === 'errore'
                      ? 'rounded-md bg-red-50 px-3 py-2 text-sm text-red-800'
                      : 'rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-800'
                  }
                >
                  {esito.testo}
                </p>
              ) : null}
            </div>
          </form>

          {/* Registro */}
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                Registro dei payload ({data.log.length})
              </h3>
              <span className="text-xs text-slate-500">
                dal più recente · in memoria, si azzera al riavvio
              </span>
            </div>
            {data.log.length === 0 ? (
              <EmptyState
                title="Nessun messaggio generato finora"
                description={
                  data.provider === 'mock'
                    ? 'Con SPOKI_PROVIDER=mock i messaggi passano dal finto WhatsApp e non compaiono qui: imposta SPOKI_PROVIDER=real e SPOKI_MODE=simulation in .env.local per vedere i payload.'
                    : 'Inserisci un cliente a mano, o usa il messaggio di prova: il payload comparirà qui.'
                }
              />
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
                {data.log.map((e) => (
                  <li key={e.id} className="px-3 py-2 text-sm">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3 select-none">
                        <span className="font-mono text-xs text-slate-500 tabular-nums">
                          {formatDateTimeIt(e.at, timeZone)}
                        </span>
                        <Badge tone={e.mode === 'simulation' ? 'warning' : 'info'}>{e.mode}</Badge>
                        <span className="font-semibold">{e.templateKind}</span>
                        <span className="font-mono text-slate-600">{e.phoneMasked}</span>
                        <Badge tone={e.outcome.ok ? 'success' : 'neutral'}>
                          {e.outcome.ok
                            ? `${e.outcome.httpStatus ?? 200} OK`
                            : (e.outcome.error ?? 'errore')}
                        </Badge>
                        <span className="ml-auto text-xs text-slate-400">{e.templateKey}</span>
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
                        {JSON.stringify(
                          {
                            url: e.url,
                            payload: e.payload,
                            outcome: e.outcome,
                            correlationId: e.correlationId,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Guida */}
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-700">
            <h3 className="text-sm font-bold text-slate-900">Come passare alle chiavi vere</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                In Spoki apri <strong>Integrazioni API</strong> e copia la{' '}
                <strong>chiave API</strong> dell&apos;account.
              </li>
              <li>
                Crea tre <strong>automazioni</strong> (conferma, turno in arrivo, annullamento),
                ognuna collegata al template WhatsApp approvato, e copia l&apos;
                <strong>URL del webhook</strong> di ciascuna. Il payload che riceveranno è quello
                del registro qui sopra (campi{' '}
                <span className="font-mono">phone, first_name, code, plate, portal_url, text</span>
                ).
              </li>
              <li>
                Nel file <span className="font-mono">.env.local</span> del server imposta{' '}
                <span className="font-mono">SPOKI_PROVIDER=real</span>,{' '}
                <span className="font-mono">SPOKI_API_KEY</span>,{' '}
                <span className="font-mono">SPOKI_URL_CONFIRMATION</span>,{' '}
                <span className="font-mono">SPOKI_URL_TURN_APPROACHING</span>,{' '}
                <span className="font-mono">SPOKI_URL_CANCELLATION</span> e{' '}
                <span className="font-mono">PUBLIC_BASE_URL</span> (indirizzo pubblico del portale).
              </li>
              <li>
                Lascia <span className="font-mono">SPOKI_MODE=simulation</span>, riavvia e verifica
                i payload nel registro; quando sono corretti passa a{' '}
                <span className="font-mono">SPOKI_MODE=live</span>, riavvia e fai un messaggio di
                prova al tuo numero. Da quel momento i messaggi consumano crediti WhatsApp.
              </li>
            </ol>
            <p className="mt-2 text-xs text-slate-500">
              La modalità live richiede anche <span className="font-mono">SESSION_SECRET</span> e il
              seed senza credenziali demo: il server si rifiuta di partire altrimenti.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
