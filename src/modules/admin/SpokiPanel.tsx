'use client';

// Integrazione Spoki & messaggistica, per l'amministratore: com'è configurata (interruttore,
// provider, modalità, blocco di sicurezza, automazioni dei promemoria, template dei messaggi del
// check-in, segreto dei webhook), un invio di prova a un numero digitato a mano, il registro dei
// payload generati (con il blocco attivo è l'unica traccia) e la guida per passare al live. Tutto in una sezione: chi entra qui vuole capire in un colpo d'occhio se i
// messaggi partono davvero e cosa contengono.
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SPOKI_TEST_KIND_LABELS,
  type SpokiBlockReason,
  type SpokiTestKind,
} from '@/application/messaging/SpokiDiagnosticsService';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
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

const BLOCK_LABELS: Record<Exclude<SpokiBlockReason, null>, string> = {
  MOCK_PROVIDER: 'provider mock: nessun invio reale',
  DISABLED: 'SPOKI_ENABLED=false: integrazione spenta, i payload finiscono solo nel registro',
  SIMULATION: 'simulazione: nessuna chiamata a Spoki',
  SAFETY_LOCK: 'SAFETY LOCK attivo: chiamate bloccate',
};

export function SpokiPanel({ timeZone }: SpokiPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-spoki'] as const,
    queryFn: fetchSpokiOverview,
    refetchInterval: 15_000,
  });
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<SpokiTestKind>('REMINDER_PREVIOUS_DAY');
  const [firstName, setFirstName] = useState('');
  const [invio, setInvio] = useState(false);
  const [esito, setEsito] = useState<{ tono: 'ok' | 'errore'; testo: string } | null>(null);

  const data = query.data;
  const bloccato = data !== undefined && !data.liveDeliveryAllowed;

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
        testo: `${r.dryRun ? 'Simulato, nessun invio reale' : 'INVIATO DAVVERO'} (${r.templateKey}, id ${r.receipt.providerMessageId}): "${r.renderedText}"`,
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
    <Panel id="spoki" aria-labelledby="spoki-titolo">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="spoki-titolo" className="text-lg font-semibold">
            Integrazione Spoki &amp; messaggistica
          </h2>
          <p className="text-sm text-slate-600">
            Quattro WhatsApp ai clienti: i promemoria del <strong>giorno prima</strong> e del{' '}
            <strong>giorno stesso</strong> (automazioni), il{' '}
            <strong>benvenuto alla presa in carico</strong> con il link personale al portale e la
            conferma di <strong>accettazione completata</strong> (template via API). Finché
            l&apos;integrazione è spenta, il blocco di sicurezza è attivo o la modalità non è live,
            nessun messaggio parte davvero: i payload finiscono nel registro qui sotto. Gli esiti
            (inviato, consegnato, letto) tornano dal webhook e si vedono in coda e in archivio.
          </p>
        </div>
        {data !== undefined ? (
          <div className="flex flex-wrap gap-2">
            {/* Lo standby viene prima di tutto: se è acceso, il resto della riga è cronaca di una
                configurazione che in questo momento non manda niente. */}
            {data.standby ? <Badge tone="warning">INTEGRAZIONE IN STANDBY</Badge> : null}
            <Badge tone={data.enabled ? 'success' : 'neutral'} data-testid="spoki-enabled">
              {data.enabled ? 'SPOKI_ENABLED' : 'SPOKI_ENABLED=false'}
            </Badge>
            <Badge tone={data.provider === 'mock' ? 'neutral' : 'info'}>
              provider {data.provider}
            </Badge>
            <Badge tone={data.mode === 'simulation' ? 'warning' : 'success'}>
              {data.mode === 'simulation' ? 'SIMULAZIONE' : 'LIVE'}
            </Badge>
            <Badge tone={data.safetyLock ? 'danger' : 'success'}>
              {data.safetyLock ? 'SAFETY LOCK ATTIVO' : 'safety lock tolto'}
            </Badge>
            <Badge tone={data.consentOverride ? 'warning' : 'neutral'}>
              {data.consentOverride ? 'CONSENSO: OVERRIDE DI SERVIZIO' : 'consenso: solo opt-in'}
            </Badge>
            <Badge tone={data.liveDeliveryAllowed ? 'success' : 'neutral'}>
              {data.liveDeliveryAllowed ? 'INVII REALI ABILITATI' : 'nessun invio reale'}
            </Badge>
            <Badge tone={data.demo.publicSends ? 'danger' : 'info'} data-testid="spoki-demo">
              {data.demo.publicSends
                ? 'APERTO AL PUBBLICO'
                : `DEMO INTERNA · ${data.demo.allowedRecipientsMasked.length} numeri ammessi`}
            </Badge>
            <Badge
              tone={data.webhookSecretConfigured ? 'success' : 'warning'}
              data-testid="spoki-webhook"
            >
              {data.webhookSecretConfigured
                ? `webhook V2: ${data.webhookSecretsCount} segret${data.webhookSecretsCount === 1 ? 'o' : 'i'}`
                : 'webhook esiti: spento'}
            </Badge>
            <Badge
              tone={data.repliesByAutomation ? 'success' : 'neutral'}
              data-testid="spoki-risposte"
            >
              {data.repliesByAutomation ? 'pulsanti: risponde Spoki' : "pulsanti: risponde l'app"}
            </Badge>
          </div>
        ) : null}
      </div>

      {query.isPending || data === undefined ? (
        <TableSkeleton rows={4} columns={3} label="Caricamento dello stato Spoki" />
      ) : (
        <div className="flex flex-col gap-6">
          {data.standby ? (
            <p className="border-status-in-progress/40 bg-status-in-progress-soft text-status-in-progress-ink rounded-md border px-3 py-2 text-sm">
              <strong>Integrazione con il cliente in pausa</strong> (`MESSAGING_STANDBY=true`):
              promemoria programmati, messaggi guidati dagli eventi e webhook delle risposte sono
              fermi di proposito, mentre si lavora al resto dell&apos;applicazione. Il resto del
              sistema funziona normalmente e non servono credenziali Spoki. Per riaccendere,
              togliere la variabile da <code>.env.local</code> e riavviare.
            </p>
          ) : null}
          {bloccato && data.blockReason !== null ? (
            <p
              role="status"
              className="border-status-in-progress/40 bg-status-in-progress-soft text-status-in-progress-ink rounded-lg border px-3 py-2 text-sm"
            >
              Guardrail: {BLOCK_LABELS[data.blockReason]}. Nessun cliente reale viene notificato.
            </p>
          ) : (
            <p
              role="alert"
              className="border-status-no-show/40 bg-status-no-show-soft text-status-no-show-ink rounded-lg border px-3 py-2 text-sm font-semibold"
            >
              ATTENZIONE: invii reali abilitati. Ogni messaggio raggiunge un telefono vero e consuma
              un credito WhatsApp.
            </p>
          )}

          {/* Configurazione */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Chiave API (SPOKI_API_KEY) e orari
              </p>
              <p className="mt-1 font-mono text-sm">
                {data.apiKeyConfigured ? data.apiKeyMasked : 'non impostata'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Giorno prima alle{' '}
                <span className="font-mono">{data.reminderPreviousDayHourLocal}</span>
                {' · '}giorno stesso alle{' '}
                <span className="font-mono">{data.reminderSameDayHourLocal}</span>
                {data.safetyNetTime === null ? (
                  ' · rete di sicurezza Spoki spenta'
                ) : (
                  <>
                    {' · '}rete di sicurezza Spoki alle{' '}
                    <span className="font-mono">{data.safetyNetTime}</span>
                  </>
                )}
                {data.remindersEnabled ? '' : ' · promemoria programmati DISATTIVATI'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Link al portale nei messaggi:{' '}
                <span className="font-mono">{data.publicBaseUrl}</span>
                /portal?targa=…&amp;t=…
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Webhook degli esiti (Spoki → Integrazioni → Webhook, eventi{' '}
                <span className="font-mono">message.outbound</span> e{' '}
                <span className="font-mono">message.inbound</span>, versione 2):{' '}
                <span className="font-mono">{data.webhookUrl}</span>
                {data.webhookSecretConfigured
                  ? ' · firma verificata con SPOKI_WEBHOOK_SECRET'
                  : ' · SPOKI_WEBHOOK_SECRET assente: gli esiti non vengono accettati'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Automazioni e template
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {data.templates.map((t) => (
                  <li key={t.kind} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {t.label}{' '}
                      <span className="font-mono text-xs text-slate-500">
                        {t.transport === 'AUTOMATION' ? t.urlEnvKey : t.templateEnvKey}
                      </span>
                    </span>
                    {t.transport === 'AUTOMATION' ? (
                      <span className="flex gap-1">
                        <Badge
                          tone={t.urlConfigured ? 'success' : 'warning'}
                          title={t.urlPreview ?? undefined}
                        >
                          {t.urlConfigured ? 'URL ok' : 'URL mancante'}
                        </Badge>
                        <Badge tone={t.secretConfigured ? 'success' : 'warning'}>
                          {t.secretConfigured ? 'segreto ok' : 'segreto mancante'}
                        </Badge>
                      </span>
                    ) : (
                      <span className="flex gap-1">
                        <Badge tone={t.templateConfigured ? 'success' : 'warning'}>
                          {t.templateConfigured
                            ? `template ${t.templateId ?? ''}`
                            : 'id template mancante'}
                        </Badge>
                        <Badge tone={data.apiKeyConfigured ? 'success' : 'warning'}>
                          {data.apiKeyConfigured ? 'via API' : 'serve SPOKI_API_KEY'}
                        </Badge>
                      </span>
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
            <h3 className="text-sm font-bold text-slate-900">Invio test manuale</h3>
            <p className="mt-0.5 mb-3 text-xs text-slate-500">
              Il numero va digitato a mano: le liste clienti non si usano e il numero di un cliente
              in agenda viene rifiutato. Dati fittizi (pratica F999, targa AB123CD, ore 09:30).{' '}
              {bloccato
                ? 'Con il guardrail attivo finisce solo nel registro.'
                : 'ATTENZIONE: parte un WhatsApp vero e consuma un credito.'}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="spoki-phone">Numero (digitato a mano)</Label>
                <Input
                  id="spoki-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="+39 333 1234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="spoki-kind">Messaggio</Label>
                <Select
                  id="spoki-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as SpokiTestKind)}
                >
                  {(Object.keys(SPOKI_TEST_KIND_LABELS) as SpokiTestKind[]).map((k) => (
                    <option key={k} value={k}>
                      {SPOKI_TEST_KIND_LABELS[k]}
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
              <Button type="submit" size="touch" disabled={invio || phone.trim() === ''}>
                {invio ? 'Invio…' : bloccato ? 'Simula invio' : 'Invia messaggio di prova'}
              </Button>
              {esito !== null ? (
                <p
                  role={esito.tono === 'errore' ? 'alert' : 'status'}
                  className={
                    esito.tono === 'errore'
                      ? 'bg-status-no-show-soft text-status-no-show-ink rounded-md px-3 py-2 text-sm'
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
                dal più recente · in memoria, si azzera al riavvio · segreto mascherato
              </span>
            </div>
            {data.log.length === 0 ? (
              <EmptyState
                title="Nessun messaggio generato finora"
                description={
                  data.provider === 'mock'
                    ? 'Con SPOKI_PROVIDER=mock i messaggi passano dal finto WhatsApp e non compaiono qui: imposta SPOKI_PROVIDER=real e SPOKI_MODE=simulation in .env.local per vedere i payload.'
                    : 'Usa il test manuale, oppure attendi i promemoria programmati: il payload comparirà qui.'
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
                        <Badge tone={e.blockedBy === null ? 'info' : 'warning'}>
                          {e.blockedBy === null
                            ? 'INVIATO'
                            : e.blockedBy === 'SAFETY_LOCK'
                              ? 'bloccato · safety lock'
                              : e.blockedBy === 'DEMO_ALLOWLIST'
                                ? 'demo · numero fuori lista'
                                : 'simulato'}
                        </Badge>
                        <span className="font-semibold">{e.templateKind}</span>
                        <span className="font-mono text-slate-600">{e.phoneMasked}</span>
                        <Badge tone={e.outcome.ok ? 'success' : 'neutral'}>
                          {e.outcome.ok
                            ? `${e.outcome.httpStatus ?? 200} OK`
                            : (e.outcome.error ?? 'errore')}
                        </Badge>
                        <span className="text-ink-muted ml-auto text-xs">{e.templateKey}</span>
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
                        {JSON.stringify(
                          {
                            url: e.url,
                            payload: e.payload,
                            blockedBy: e.blockedBy,
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
            <h3 className="text-sm font-bold text-slate-900">Come funziona e come si sblocca</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                <span className="font-mono">SPOKI_ENABLED=true</span> con{' '}
                <span className="font-mono">SPOKI_API_KEY</span> accende l&apos;integrazione; senza,
                la modalità effettiva resta la simulazione qualunque cosa dica{' '}
                <span className="font-mono">SPOKI_MODE</span>.
              </li>
              <li>
                I messaggi del check-in partono via API (
                <span className="font-mono">POST /api/1/messages/send/</span>, intestazione{' '}
                <span className="font-mono">X-Spoki-Api-Key</span>) con l&apos;id del template
                approvato: <span className="font-mono">SPOKI_TEMPLATE_WELCOME_ID</span> alla presa
                in carico (con <span className="font-mono">ACC_LINK</span> personale) e{' '}
                <span className="font-mono">SPOKI_TEMPLATE_COMPLETE_ID</span> a check-in concluso.
              </li>
              <li>
                Gli esiti tornano su <span className="font-mono">{data.webhookUrl}</span> firmati
                con <span className="font-mono">X-Spoki-Signature</span> (HMAC-SHA256 del corpo,
                segreto <span className="font-mono">SPOKI_WEBHOOK_SECRET</span>): inviato,
                consegnato, letto o fallito compaiono sulla pratica in coda e in archivio.
              </li>
              <li>
                Ogni automazione Spoki riceve un POST JSON nel formato del fornitore:{' '}
                <span className="font-mono">
                  {
                    '{ secret, phone, first_name, last_name, email, custom_fields: { ACC_CODICE, ACC_TARGA, ACC_DATA, ACC_ORA, ACC_GIORNO, ACC_LINK, ACC_PROMEMORIA } }'
                  }
                </span>
                . Il segreto è quello della singola automazione (
                <span className="font-mono">SPOKI_SECRET_REMINDER_PREVIOUS_DAY</span>,{' '}
                <span className="font-mono">SPOKI_SECRET_REMINDER_SAME_DAY</span>), gli URL sono{' '}
                <span className="font-mono">SPOKI_URL_REMINDER_PREVIOUS_DAY</span> e{' '}
                <span className="font-mono">SPOKI_URL_REMINDER_SAME_DAY</span>.
              </li>
              <li>
                Il promemoria del giorno prima parte alle{' '}
                <span className="font-mono">{data.reminderPreviousDayHourLocal}</span> dopo aver
                anticipato l&apos;agenda di domani (così il codice esiste già); quello del giorno
                stesso alle <span className="font-mono">{data.reminderSameDayHourLocal}</span>, dopo
                la sync. Entrambi sono idempotenti per pratica e giornata.
              </li>
              <li>
                Guardrail: con <span className="font-mono">SPOKI_MODE=simulation</span> oppure{' '}
                <span className="font-mono">SPOKI_SAFETY_LOCK=true</span> nessuna chiamata HTTP
                parte. Verifica qui i payload finché sono giusti.
              </li>
              <li>
                Per andare in produzione: <span className="font-mono">SPOKI_MODE=live</span> e{' '}
                <span className="font-mono">SPOKI_SAFETY_LOCK=false</span>, riavvio, poi un solo
                messaggio di prova al proprio numero. Da quel momento i messaggi consumano crediti
                WhatsApp e raggiungono i clienti.
              </li>
            </ol>
            <p className="mt-2 text-xs text-slate-500">
              La modalità live richiede anche <span className="font-mono">SESSION_SECRET</span> e il
              seed senza credenziali demo: il server si rifiuta di partire altrimenti.
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
