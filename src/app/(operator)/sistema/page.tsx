// Pagina Sistema (area autenticata): stato delle quattro porte esterne tramite il container.
// Erede della pagina di verifica del bootstrap; da M6 ospiterà anche outbox CRM e log delle sync.
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  checkExternalHealth,
  isStartupError,
  providerKindsFromEnv,
  type SystemHealth,
  type SystemHealthStatus,
} from '@/application/health/check-health';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { getContainer } from '@/config/container';
import { formatDateTimeIt } from '@/lib/dates';
import type { HealthStatus } from '@/services/interfaces/common';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sistema' };

const NOT_AVAILABLE = 'n/d';

const PROVIDER_LABELS: Record<HealthStatus['provider'], string> = {
  INFINITY: 'Infinity (agenda DMS)',
  SPOKI: 'Spoki (WhatsApp)',
  SMS_HOSTING: 'SMS Hosting (SMS di fallback)',
  CRM: 'CRM / BDC (webhook)',
};

const STATUS_LABELS: Record<HealthStatus['status'] | SystemHealthStatus, string> = {
  UP: 'Operativo',
  DEGRADED: 'Degradato',
  DOWN: 'Non disponibile',
  UNKNOWN: 'Sconosciuto',
};

const STATUS_TONES: Record<HealthStatus['status'] | SystemHealthStatus, BadgeTone> = {
  UP: 'success',
  DEGRADED: 'warning',
  DOWN: 'danger',
  UNKNOWN: 'neutral',
};

function HealthBadge({ status }: { readonly status: HealthStatus['status'] | SystemHealthStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} title={status}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

type PageData =
  | { readonly kind: 'ok'; readonly health: SystemHealth; readonly timeZone: string }
  | { readonly kind: 'startup-error'; readonly name: string; readonly message: string };

async function loadPageData(): Promise<PageData> {
  try {
    const container = getContainer();
    const health = await checkExternalHealth(container.external, {
      clock: container.clock,
      kinds: providerKindsFromEnv(container.env),
    });
    return { kind: 'ok', health, timeZone: container.env.timeZone };
  } catch (error) {
    if (!isStartupError(error)) {
      throw error;
    }
    return { kind: 'startup-error', name: error.name, message: error.message };
  }
}

export default async function SistemaPage() {
  const data = await loadPageData();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Sistema</h1>
        <p className="text-sm text-slate-600">
          Stato delle porte esterne selezionate dal container (architettura Mock-First): oggi
          rispondono i Mock, domani gli adapter reali senza modifiche alla dashboard.
        </p>
      </header>

      {data.kind === 'startup-error' ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm" role="alert">
          <h2 className="text-lg font-semibold text-red-900">Configurazione non valida</h2>
          <p className="mt-2 text-sm text-red-800">
            Il container non può essere costruito (<code>{data.name}</code>): {data.message}
          </p>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Porte esterne</h2>
            <HealthBadge status={data.health.status} />
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500 uppercase">
              <tr>
                <th scope="col" className="pb-2">
                  Porta
                </th>
                <th scope="col" className="pb-2">
                  Stato
                </th>
                <th scope="col" className="pb-2">
                  Implementazione
                </th>
                <th scope="col" className="pb-2">
                  Dettaglio
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.health.providers.map((p) => (
                <tr key={p.provider}>
                  <td className="py-2 font-medium">{PROVIDER_LABELS[p.provider]}</td>
                  <td className="py-2">
                    <HealthBadge status={p.status} />
                  </td>
                  <td className="py-2 font-mono text-xs">{p.implementation}</td>
                  <td className="py-2 text-slate-600">{p.detail ?? NOT_AVAILABLE}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-slate-500">
            Ultimo controllo:{' '}
            {data.health.checkedAt === null
              ? NOT_AVAILABLE
              : formatDateTimeIt(data.health.checkedAt, data.timeZone)}{' '}
            ({data.timeZone}). Endpoint JSON:{' '}
            <Link href="/api/v1/health" className="underline hover:text-slate-800">
              /api/v1/health
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
