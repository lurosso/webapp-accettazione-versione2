// Pagina di test del bootstrap: verifica che l'app si avvii e che il container Mock-First funzioni.
// Server Component: interroga l'healthCheck delle quattro porte esterne a ogni richiesta.
// In M1 (M1-T10-S02) questa pagina reindirizzerà verso /accettazione o /login.
import Link from 'next/link';
import { getContainer } from '@/config/container';
import {
  checkExternalHealth,
  isStartupError,
  providerKindsFromEnv,
  type SystemHealth,
  type SystemHealthStatus,
} from '@/application/health/check-health';
import { formatDateTimeIt } from '@/lib/dates';
import type { HealthStatus } from '@/services/interfaces/common';

export const dynamic = 'force-dynamic';

/** Segnaposto unico per i valori assenti. */
const NOT_AVAILABLE = 'n/d';

/** Etichette italiane delle porte. */
const PROVIDER_LABELS: Record<HealthStatus['provider'], string> = {
  INFINITY: 'Infinity (agenda DMS)',
  SPOKI: 'Spoki (WhatsApp)',
  SMS_HOSTING: 'SMS Hosting (SMS di fallback)',
  CRM: 'CRM / BDC (webhook)',
};

/** Etichette italiane degli stati (il codice tecnico resta nel `title`). */
const STATUS_LABELS: Record<HealthStatus['status'] | SystemHealthStatus, string> = {
  UP: 'Operativo',
  DEGRADED: 'Degradato',
  DOWN: 'Non disponibile',
  UNKNOWN: 'Sconosciuto',
};

/** Classi Tailwind dei badge di stato. */
const STATUS_CLASSES: Record<HealthStatus['status'] | SystemHealthStatus, string> = {
  UP: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  DEGRADED: 'bg-amber-100 text-amber-800 ring-amber-300',
  DOWN: 'bg-red-100 text-red-800 ring-red-300',
  UNKNOWN: 'bg-slate-100 text-slate-700 ring-slate-300',
};

function StatusBadge({ status }: { readonly status: HealthStatus['status'] | SystemHealthStatus }) {
  return (
    <span
      title={status}
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Esito della lettura del container: stato delle porte oppure errore di avvio leggibile. */
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

function StartupErrorPanel({ name, message }: { readonly name: string; readonly message: string }) {
  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm" role="alert">
      <h2 className="text-lg font-semibold text-red-900">Configurazione non valida</h2>
      <p className="mt-2 text-sm text-red-800">
        Il container non può essere costruito (<code>{name}</code>): {message}
      </p>
      <p className="mt-3 text-sm text-red-800">
        Suggerimento: impostare <code>SERVICES_PROVIDER=mock</code> (e <code>NODE_ENV</code> diverso da{' '}
        <code>production</code> finché il seed contiene credenziali demo) e riavviare il server.
      </p>
    </section>
  );
}

function HealthPanel({ health, timeZone }: { readonly health: SystemHealth; readonly timeZone: string }) {
  const lastCheck = health.checkedAt === null ? NOT_AVAILABLE : formatDateTimeIt(health.checkedAt, timeZone);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Stato delle porte esterne</h2>
        <StatusBadge status={health.status} />
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
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
          {health.providers.map((p) => (
            <tr key={p.provider}>
              <td className="py-2 font-medium">{PROVIDER_LABELS[p.provider]}</td>
              <td className="py-2">
                <StatusBadge status={p.status} />
              </td>
              <td className="py-2 font-mono text-xs">{p.implementation}</td>
              <td className="py-2 text-slate-600">{p.detail ?? NOT_AVAILABLE}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-slate-500">
        Ultimo controllo: {lastCheck} ({timeZone}). Endpoint JSON:{' '}
        <Link href="/api/v1/health" className="underline hover:text-slate-800">
          /api/v1/health
        </Link>
      </p>
    </section>
  );
}

export default async function HomePage() {
  const data = await loadPageData();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Autoclub Group</p>
        <h1 className="text-3xl font-bold tracking-tight">Gestione Accettazione e Flussi Officina</h1>
        <p className="text-slate-600">
          Bootstrap completato: Next.js App Router, TypeScript strict e Tailwind CSS sono attivi. Le porte
          esterne rispondono tramite i <strong>Mock</strong> selezionati dal container (architettura
          Mock-First).
        </p>
      </header>

      {data.kind === 'ok' ? (
        <HealthPanel health={data.health} timeZone={data.timeZone} />
      ) : (
        <StartupErrorPanel name={data.name} message={data.message} />
      )}

      <footer className="text-xs text-slate-500">
        Prossimi passi in <code>TASKS.md</code>: M0-T07 (Tailwind/shadcn), M0-T08 (ESLint), M1 (Dashboard
        Accettazione).
      </footer>
    </main>
  );
}
