'use client';

// La diagnostica della pagina Sistema, com'è vista da chi sta al banco: una riga per componente
// (Infinity, Spoki, SMS, CRM, storage dei media, sincronizzazione, rete), con stato, dettaglio,
// codice e — accanto a ognuna — «Segnala ad Admin». Sotto, una segnalazione libera per quello
// che nessun controllo vede: la stampante, il tablet, il lettore del QR.
//
// La rete la misura il browser intorno alla chiamata di diagnostica: `navigator.onLine` dice se
// c'è un collegamento, la latenza dice se è utilizzabile. Il server non può saperlo al posto suo.
import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  DiagnosticRowView,
  DiagnosticStatus,
  SystemDiagnosticsView,
} from '@/application/system/SystemDiagnosticsService';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { TableSkeleton } from '@/components/ui/skeleton';
import {
  SYSTEM_ALERT_COMPONENT_LABELS,
  SYSTEM_ALERT_COMPONENTS,
  type SystemAlertComponent,
} from '@/domain/entities/system-alert';
import { ApiError, fetchSystemDiagnostics, postSystemAlert } from '@/lib/api-client/client';
import { formatDateTimeIt } from '@/lib/dates';

export interface SystemDiagnosticsPanelProps {
  readonly timeZone: string;
}

const STATUS_LABELS: Readonly<Record<DiagnosticStatus, string>> = {
  UP: 'Operativo',
  DEGRADED: 'Degradato',
  DOWN: 'Non disponibile',
  UNKNOWN: 'Sconosciuto',
};

const STATUS_TONES: Readonly<Record<DiagnosticStatus, BadgeTone>> = {
  UP: 'success',
  DEGRADED: 'warning',
  DOWN: 'danger',
  UNKNOWN: 'neutral',
};

/** Ogni quanto la diagnostica si rilegge da sola. */
const OGNI_MS = 30_000;
/** Oltre questa latenza la rete c'è ma non si lavora. */
const RETE_LENTA_MS = 1_500;

interface Diagnostica {
  readonly checkedAt: SystemDiagnosticsView['checkedAt'];
  readonly rows: readonly DiagnosticRowView[];
  /** Quanto ha impiegato la chiamata: è la misura della rete dal punto di vista del tablet. */
  readonly latenzaMs: number;
}

/** La riga della rete, calcolata dal browser: collegamento e latenza verso il server. */
function rigaRete(online: boolean, latenzaMs: number | null): DiagnosticRowView {
  if (!online) {
    return {
      component: 'NETWORK',
      label: 'Rete / connettività',
      status: 'DOWN',
      code: 'NETWORK-OFFLINE',
      detail: 'Il dispositivo non è collegato alla rete.',
      latencyMs: null,
      implementation: null,
    };
  }
  if (latenzaMs !== null && latenzaMs > RETE_LENTA_MS) {
    return {
      component: 'NETWORK',
      label: 'Rete / connettività',
      status: 'DEGRADED',
      code: 'NETWORK-SLOW',
      detail: `Collegato, ma il server risponde in ${latenzaMs} ms.`,
      latencyMs: latenzaMs,
      implementation: null,
    };
  }
  return {
    component: 'NETWORK',
    label: 'Rete / connettività',
    status: 'UP',
    code: null,
    detail:
      latenzaMs === null ? 'Collegato.' : `Collegato · risposta del server in ${latenzaMs} ms.`,
    latencyMs: latenzaMs,
    implementation: null,
  };
}

function iscrivitiAllaRete(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** Il codice con cui si segnala una riga: quello del controllo, o uno generico se è verde. */
function codiceSegnalazione(row: DiagnosticRowView): string {
  return row.code ?? `${row.component}-SEGNALAZIONE`;
}

export function SystemDiagnosticsPanel({ timeZone }: SystemDiagnosticsPanelProps) {
  // Il collegamento del dispositivo è uno stato esterno: si legge da  e si
  // ascoltano gli eventi del browser, senza copiarlo in uno stato React a mano.
  const online = useSyncExternalStore(
    iscrivitiAllaRete,
    () => navigator.onLine,
    () => true,
  );
  const [inviata, setInviata] = useState<{ code: string; component: string } | null>(null);
  const [componente, setComponente] = useState<SystemAlertComponent>('HARDWARE');
  const [testo, setTesto] = useState('');

  const diagnostica = useQuery<Diagnostica>({
    queryKey: ['system-diagnostics'],
    queryFn: async () => {
      const inizio = performance.now();
      const r = await fetchSystemDiagnostics();
      return { ...r, latenzaMs: Math.round(performance.now() - inizio) };
    },
    refetchInterval: OGNI_MS,
  });

  const segnala = useMutation({
    mutationFn: (body: { code: string; component: SystemAlertComponent; message: string }) =>
      postSystemAlert(body),
    onSuccess: (r) => {
      setInviata({ code: r.alert.code, component: r.alert.component });
      setTesto('');
    },
  });

  const righe: readonly DiagnosticRowView[] = [
    ...(diagnostica.data?.rows ?? []),
    rigaRete(online, diagnostica.data?.latenzaMs ?? null),
  ];
  const erroreInvio =
    segnala.error instanceof ApiError
      ? segnala.error.message
      : segnala.isError
        ? 'Segnalazione non inviata: controlla la connessione e riprova.'
        : null;

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <PanelHeader
          title="Stato del sistema"
          description="Una riga per ogni componente che può fermare l’officina. Se qualcosa è rosso o giallo, «Segnala ad Admin» manda codice, dettaglio, chi sei e da quale postazione."
          meta={
            diagnostica.data !== undefined ? (
              <span className="text-ink-muted testo-nota">
                Ultimo controllo {formatDateTimeIt(diagnostica.data.checkedAt, timeZone)} · si
                aggiorna ogni 30 s
              </span>
            ) : null
          }
        />
        {inviata !== null ? (
          <Notice tone="success" data-testid="segnalazione-inviata">
            Segnalazione inviata all&apos;amministratore: codice <strong>{inviata.code}</strong> (
            {SYSTEM_ALERT_COMPONENT_LABELS[inviata.component as SystemAlertComponent] ??
              inviata.component}
            ).
          </Notice>
        ) : null}
        {erroreInvio !== null ? <Notice tone="error">{erroreInvio}</Notice> : null}
        {diagnostica.isPending ? (
          <TableSkeleton rows={6} columns={4} label="Controllo del sistema" />
        ) : diagnostica.isError ? (
          <EmptyState
            title="Diagnostica non disponibile"
            description="Il server non risponde alla diagnostica: è già di per sé una segnalazione. Riprova fra qualche istante o usa la segnalazione libera qui sotto."
          />
        ) : (
          <ul className="divide-line flex flex-col divide-y" data-testid="diagnostica-righe">
            {righe.map((r) => (
              <li
                key={r.component}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                data-testid={`diagnostica-${r.component}`}
                data-stato={r.status}
              >
                <div className="flex min-w-[14rem] flex-1 flex-col gap-0.5">
                  <span className="testo-corpo font-semibold">{r.label}</span>
                  <span className="text-ink-muted testo-nota">
                    {r.detail ?? 'Nessun dettaglio'}
                    {r.implementation !== null ? ` · ${r.implementation}` : ''}
                  </span>
                </div>
                <Badge tone={STATUS_TONES[r.status]} title={r.status}>
                  {STATUS_LABELS[r.status]}
                </Badge>
                <span className="text-ink-muted testo-nota w-44 font-mono">{r.code ?? '—'}</span>
                <Button
                  variant={r.status === 'UP' ? 'outline' : 'default'}
                  size="sm"
                  disabled={segnala.isPending}
                  data-testid={`segnala-${r.component}`}
                  onClick={() =>
                    segnala.mutate({
                      code: codiceSegnalazione(r),
                      component: r.component,
                      message: `${r.label}: ${STATUS_LABELS[r.status]}${r.detail === null ? '' : ` — ${r.detail}`}`,
                    })
                  }
                >
                  Segnala ad Admin
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Segnala un’altra disfunzione"
          description="Per quello che nessun controllo vede: stampanti, tablet, lettore del QR, cavi. Scrivi cosa succede; chi sei e da quale postazione lo aggiunge il sistema."
        />
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (testo.trim() === '') {
              return;
            }
            segnala.mutate({
              code: `${componente}-MANUALE`,
              component: componente,
              message: testo.trim(),
            });
          }}
        >
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex w-64 flex-col gap-1.5">
              <span className="testo-nota text-ink-soft font-semibold">Componente</span>
              <select
                value={componente}
                onChange={(event) => setComponente(event.target.value as SystemAlertComponent)}
                data-testid="segnalazione-componente"
                className="controllo border-line bg-surface text-ink testo-corpo focus-anello rounded-md border px-3"
              >
                {SYSTEM_ALERT_COMPONENTS.map((c) => (
                  <option key={c} value={c}>
                    {SYSTEM_ALERT_COMPONENT_LABELS[c]}
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
                rows={2}
                placeholder="es. La stampante dello sportello B non stampa la ricevuta"
                data-testid="segnalazione-testo"
                className="border-line bg-surface text-ink testo-corpo focus-anello placeholder:text-ink-muted min-h-11 rounded-md border px-3 py-2"
              />
            </label>
            <Button
              type="submit"
              disabled={segnala.isPending || testo.trim() === ''}
              data-testid="segnalazione-invia"
            >
              {segnala.isPending ? 'Invio…' : 'Invia ad Admin'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
