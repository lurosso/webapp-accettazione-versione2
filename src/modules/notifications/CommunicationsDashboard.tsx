'use client';

// Schermata Comunicazioni: i messaggi al cliente che non sono arrivati.
//
// Una lista di lavoro, non un registro. Per ogni pratica dice cosa doveva sapere il cliente (il
// testo del messaggio, da leggergli al telefono), a che numero, cosa è andato storto e cosa sta
// facendo il sistema: se ci sta ancora provando da solo lo dice con l'ora del prossimo tentativo,
// e allora non serve nessuno; se ha finito, la riga chiede una persona.
//
// Chi la lavora preme «Prendo io» (i colleghi vedono il suo nome e non chiamano due volte), telefona
// e registra com'è andata. «Riprova invio» serve quando il guasto è passato: il sistema ripercorre
// WhatsApp e SMS come la prima volta.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@/application/auth/IAuthService';
import type { CommunicationRowView } from '@/application/notifications/CommunicationsService';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { TableSkeleton } from '@/components/ui/skeleton';
import { NOTIFICATION_MAX_AUTO_RETRIES } from '@/config/constants';
import {
  MANUAL_CONTACT_OUTCOMES,
  MANUAL_CONTACT_OUTCOME_LABELS,
  type ManualContactOutcome,
} from '@/domain/entities/notification';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import {
  ApiError,
  fetchCommunications,
  postCommunicationAction,
  type CommunicationCommand,
} from '@/lib/api-client/client';
import { formatBusinessDateIt, formatDateTimeIt, localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { WHATSAPP_KIND_LABELS } from '@/modules/reception/WhatsAppBadge';

/** Stesso ritmo del BDC: qui si telefona, e una lista che si riordina troppo spesso si telefona male. */
export const COMMUNICATIONS_POLLING_MS = 10_000;

export const communicationsKeys = {
  all: ['communications'] as const,
  list: (vista: 'open' | 'handled') => ['communications', vista] as const,
};

export interface CommunicationsDashboardProps {
  readonly session: Pick<Session, 'displayName' | 'role'>;
  /** Giornata operativa del server: la data si mostra solo per le righe di altri giorni. */
  readonly businessDate: string;
  readonly timeZone: string;
}

export function CommunicationsDashboard({
  session,
  businessDate,
  timeZone,
}: CommunicationsDashboardProps) {
  const [vista, setVista] = useState<'open' | 'handled'>('open');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: communicationsKeys.list(vista),
    queryFn: () => fetchCommunications(vista),
    refetchInterval: COMMUNICATIONS_POLLING_MS,
    refetchIntervalInBackground: true,
  });
  useLiveUpdates({
    url: '/api/v1/events/stream',
    types: ['NOTIFICATION_JOB_CHANGED'],
    invalidate: [communicationsKeys.all],
  });

  const comando = useMutation({
    mutationFn: (input: { readonly jobId: string; readonly command: CommunicationCommand }) =>
      postCommunicationAction(input.jobId, input.command),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: communicationsKeys.all }),
  });
  const errore =
    comando.error === null
      ? null
      : comando.error instanceof ApiError
        ? comando.error.message
        : 'Il comando non è arrivato al server: riprova fra poco.';
  const inCorso = comando.isPending ? comando.variables.jobId : null;
  const privilegiato = session.role === 'ADMIN';

  const data = query.data;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-ink text-2xl font-bold tracking-tight">Comunicazioni</h1>
          <p className="text-ink-soft testo-corpo max-w-prose">
            I messaggi al cliente che non sono arrivati. Finché il sistema ritenta da solo lo trovi
            scritto sulla riga; quando ha finito, il cliente va contattato a mano: prendi in carico,
            chiama e registra l&apos;esito.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <Badge tone={data !== undefined && data.openCount > 0 ? 'danger' : 'success'} dot>
            {data === undefined ? '—' : `${data.openCount} da contattare a mano`}
          </Badge>
          <Badge tone={data !== undefined && data.retryingCount > 0 ? 'warning' : 'neutral'}>
            {data === undefined ? '—' : `${data.retryingCount} in riprova automatica`}
          </Badge>
          <Badge tone="neutral">
            {data === undefined ? '—' : `${data.handledTodayCount} chiuse oggi`}
          </Badge>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Vista">
        <Button
          variant={vista === 'open' ? 'default' : 'outline'}
          size="touch"
          aria-pressed={vista === 'open'}
          onClick={() => setVista('open')}
        >
          Da gestire
        </Button>
        <Button
          variant={vista === 'handled' ? 'default' : 'outline'}
          size="touch"
          aria-pressed={vista === 'handled'}
          onClick={() => setVista('handled')}
        >
          Gestite
        </Button>
        <span className="text-ink-muted testo-nota ml-auto">Operatore: {session.displayName}</span>
      </div>

      {errore !== null ? <Notice tone="error">{errore}</Notice> : null}
      {query.isError ? (
        <Notice tone="warning">
          Elenco non aggiornato: il server non risponde. Le righe a schermo restano valide, i numeri
          si possono chiamare lo stesso.
        </Notice>
      ) : null}

      {query.isPending ? (
        <TableSkeleton rows={3} columns={4} label="Caricamento delle comunicazioni" />
      ) : data === undefined || data.rows.length === 0 ? (
        <EmptyState
          size="page"
          title={vista === 'open' ? 'Nessun cliente da contattare' : 'Nessuna comunicazione chiusa'}
          description={
            vista === 'open'
              ? 'Tutti i messaggi degli ultimi giorni sono arrivati, oppure sono già stati gestiti.'
              : 'Qui compaiono i contatti fatti a mano, con l’esito e chi li ha registrati.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.rows.map((row) => (
            <li key={row.jobId}>
              <CommunicationCard
                row={row}
                today={businessDate}
                timeZone={timeZone}
                busy={inCorso === row.jobId}
                canRelease={row.claimedByMe || privilegiato}
                onCommand={(command) => comando.mutate({ jobId: row.jobId, command })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface StatusCopy {
  readonly tone: BadgeTone;
  readonly label: string;
}

/** Cosa dice la riga sullo stato: la frase è la risposta a «devo fare qualcosa?». */
function statusCopy(row: CommunicationRowView, timeZone: string): StatusCopy {
  if (row.status === 'MANUAL_CONFIRMED') {
    return { tone: 'success', label: `Gestita · ${row.manualOutcomeLabel ?? 'esito registrato'}` };
  }
  if (row.status === 'NO_RECIPIENT') {
    return { tone: 'warning', label: 'Senza numero · informare di persona' };
  }
  if (row.nextAttemptAt !== null) {
    const ora = localTimeHHmm(new Date(row.nextAttemptAt), timeZone);
    return {
      tone: 'warning',
      label: `Nuovo tentativo alle ${ora} (${row.autoRetryCount + 1}/${NOTIFICATION_MAX_AUTO_RETRIES})`,
    };
  }
  return { tone: 'danger', label: 'Da contattare a mano' };
}

interface CommunicationCardProps {
  readonly row: CommunicationRowView;
  readonly today: string;
  readonly timeZone: string;
  readonly busy: boolean;
  readonly canRelease: boolean;
  readonly onCommand: (command: CommunicationCommand) => void;
}

function CommunicationCard({
  row,
  today,
  timeZone,
  busy,
  canRelease,
  onCommand,
}: CommunicationCardProps) {
  const [esitoAperto, setEsitoAperto] = useState(false);
  const [esito, setEsito] = useState<ManualContactOutcome>(
    row.status === 'NO_RECIPIENT' ? 'INFORMED_AT_DESK' : 'PHONE_CALLED',
  );
  const [nota, setNota] = useState('');
  const stato = statusCopy(row, timeZone);
  const gestita = row.status === 'MANUAL_CONFIRMED';
  const inCaricoAdAltri = row.claimedByName !== null && !row.claimedByMe;
  // Chi non l'ha presa (e non è responsabile) la lascia a chi l'ha presa: il server lo rifiuta.
  const bloccataDaCollega = inCaricoAdAltri && !canRelease;
  // Un messaggio di un giorno passato non si rimanda: si chiude con l'esito.
  const rimandabile = row.phone !== null && row.businessDate >= today;
  const orario =
    row.scheduledAt === null
      ? null
      : `${row.businessDate === today ? '' : `${formatBusinessDateIt(row.businessDate)} · `}ore ${localTimeHHmm(new Date(row.scheduledAt), timeZone)}`;

  return (
    <Panel
      className={cn(
        'p-4 sm:p-5',
        !gestita && row.nextAttemptAt === null && 'border-status-no-show/40',
      )}
      aria-label={`Comunicazione per ${row.code}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-ink testo-codice font-mono font-bold">{row.code}</span>
            {row.plate !== null ? (
              <span className="text-ink testo-dato font-mono font-semibold">{row.plate}</span>
            ) : null}
            <span className="text-ink testo-dato font-semibold">
              {row.customerName ?? 'Cliente non più in agenda'}
            </span>
          </div>
          <p className="text-ink-soft testo-nota">
            {WHATSAPP_KIND_LABELS[row.kind]}
            {orario !== null ? ` · appuntamento ${orario}` : ''}
            {row.attemptCount > 0
              ? ` · ${row.attemptCount} ${row.attemptCount === 1 ? 'tentativo' : 'tentativi'}`
              : ''}
          </p>
        </div>
        <Badge tone={stato.tone} dot>
          {stato.label}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {row.phone !== null ? (
          <a
            href={`tel:${row.phone}`}
            className="controllo premibile focus-anello border-line bg-surface text-ink testo-dato inline-flex items-center gap-2 rounded-md border px-4 font-mono font-semibold"
          >
            <span aria-hidden="true">☎</span>
            {row.phone}
          </a>
        ) : (
          <span className="text-status-in-progress-ink testo-corpo font-semibold">
            Nessun numero in agenda
          </span>
        )}
        {row.claimedByName !== null && !gestita ? (
          <span className="text-ink-soft testo-nota">
            {row.claimedByMe ? 'In carico a te' : `In carico a ${row.claimedByName}`}
            {row.claimedAt !== null
              ? ` dalle ${localTimeHHmm(new Date(row.claimedAt), timeZone)}`
              : ''}
          </span>
        ) : null}
      </div>

      <blockquote className="bg-surface-sunken text-ink testo-corpo mt-3 rounded-md px-4 py-3 whitespace-pre-line">
        {row.renderedText}
      </blockquote>

      {row.lastError !== null && !gestita ? (
        <p className="text-ink-muted testo-nota mt-2">Ultimo errore — {row.lastError}</p>
      ) : null}

      {gestita ? (
        <p className="text-ink-soft testo-nota mt-3">
          {row.manualOutcomeLabel ?? 'Esito registrato'}
          {row.confirmedByName !== null ? ` · ${row.confirmedByName}` : ''}
          {row.confirmedAt !== null ? ` · ${formatDateTimeIt(row.confirmedAt, timeZone)}` : ''}
          {row.manualNote !== null ? (
            <span className="text-ink testo-corpo mt-1 block">«{row.manualNote}»</span>
          ) : null}
        </p>
      ) : esitoAperto ? (
        <form
          className="border-line-subtle mt-4 flex flex-col gap-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            onCommand({
              action: 'confirm',
              outcome: esito,
              note: nota.trim() === '' ? null : nota.trim(),
            });
          }}
        >
          <label className="text-ink testo-corpo flex flex-col gap-1.5 font-medium">
            Esito del contatto
            <Select
              value={esito}
              onChange={(event) => setEsito(event.target.value as ManualContactOutcome)}
            >
              {MANUAL_CONTACT_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {MANUAL_CONTACT_OUTCOME_LABELS[o]}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-ink testo-corpo flex flex-col gap-1.5 font-medium">
            Nota (facoltativa)
            <textarea
              value={nota}
              maxLength={500}
              rows={2}
              onChange={(event) => setNota(event.target.value)}
              placeholder="Es. arriva alle 11, ha già ricevuto il codice a voce"
              className="border-line bg-surface text-ink testo-corpo placeholder:text-ink-muted transizione focus-anello w-full rounded-md border px-3.5 py-2.5 shadow-xs"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="success" size="touch" disabled={busy}>
              Chiudi segnalazione
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              disabled={busy}
              onClick={() => setEsitoAperto(false)}
            >
              Annulla
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {row.claimedByName === null ? (
            <Button
              variant="default"
              size="touch"
              disabled={busy}
              onClick={() => onCommand({ action: 'claim' })}
            >
              Prendo io
            </Button>
          ) : canRelease ? (
            <Button
              variant="outline"
              size="touch"
              disabled={busy}
              onClick={() => onCommand({ action: 'release' })}
            >
              Rilascia
            </Button>
          ) : null}
          {rimandabile && !bloccataDaCollega ? (
            <Button
              variant="secondary"
              size="touch"
              disabled={busy}
              onClick={() => onCommand({ action: 'retry' })}
            >
              Riprova invio
            </Button>
          ) : null}
          {bloccataDaCollega ? null : (
            <Button
              variant={inCaricoAdAltri ? 'outline' : 'success'}
              size="touch"
              disabled={busy}
              onClick={() => setEsitoAperto(true)}
            >
              Registra esito
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
