'use client';

// Banner della sincronizzazione Infinity: esito dell'ultima sync della giornata con azione di
// riprova (fallback manuale). Nessuna sync → avviso; FAILED → rosso; PARTIAL → giallo; SUCCESS → riga discreta.
import type { SyncRun } from '@/domain/entities/sync-run';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { localTimeHHmm } from '@/lib/dates';

export interface SyncBannerProps {
  readonly lastSync: SyncRun | null;
  readonly timeZone: string;
  /** L'operatore può avviare la sync (ruolo o fallback su FAILED/assente). */
  readonly canSync: boolean;
  readonly syncing: boolean;
  readonly onSync: () => void;
  readonly message: string | null;
}

export function SyncBanner({
  lastSync,
  timeZone,
  canSync,
  syncing,
  onSync,
  message,
}: SyncBannerProps) {
  const button = canSync ? (
    <Button size="touch" variant="outline" onClick={onSync} disabled={syncing}>
      {syncing ? 'Sincronizzazione…' : lastSync === null ? 'Sincronizza ora' : 'Riprova sync'}
    </Button>
  ) : null;

  if (lastSync === null) {
    return (
      <Alert tone="warning" title="Nessuna sincronizzazione con Infinity per oggi" actions={button}>
        L&apos;agenda viene acquisita automaticamente alle 06:00. {message ?? ''}
      </Alert>
    );
  }

  const at = lastSync.finishedAt ?? lastSync.startedAt;
  const when = localTimeHHmm(new Date(at), timeZone);
  const c = lastSync.counters;

  switch (lastSync.status) {
    case 'RUNNING':
      return <Alert tone="info" title="Sincronizzazione in corso…" />;
    case 'FAILED':
      return (
        <Alert tone="error" title={`Sincronizzazione fallita alle ${when}`} actions={button}>
          {lastSync.errorMessage ?? 'Infinity non ha risposto.'} La coda mostra i dati già presenti;
          le pratiche possono essere gestite e inserite manualmente. {message ?? ''}
        </Alert>
      );
    case 'PARTIAL':
      return (
        <Alert tone="warning" title={`Sincronizzazione parziale alle ${when}`} actions={button}>
          {c.created} nuove, {c.updated} aggiornate, {c.rejected} scartate.{' '}
          {lastSync.errorMessage ?? ''} {message ?? ''}
        </Alert>
      );
    case 'SUCCESS':
      return (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Ultima sincronizzazione Infinity alle {when}: {c.fetched} appuntamenti ricevuti,{' '}
            {c.created} nuove pratiche
            {c.cancelled > 0 ? `, ${c.cancelled} annullate` : ''}.
            {message !== null ? ` ${message}` : ''}
          </span>
          {button}
        </div>
      );
  }
}
