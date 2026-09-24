// Pagina Sistema (area autenticata).
// - Accettatore: solo «Segnala un problema», il ticket verso l'amministratore. Dal 2026-09-24 lo
//   stato delle porte e le spiegazioni tecniche non stanno più qui: al banco non dicono cosa fare.
// - Amministratore: la diagnostica di tutto quello che può fermare l'officina — porte esterne,
//   storage dei media, sincronizzazione, rete — con «Segnala ad Admin» accanto a ogni riga, la
//   segnalazione libera e la coda di uscita verso il CRM. La diagnostica è un pannello client che
//   si rilegge da solo: qui il server risolve sessione e configurazione, e dice se il container
//   non si costruisce.
import type { Metadata } from 'next';
import { isStartupError } from '@/application/health/check-health';
import { getContainer } from '@/config/container';
import { requireArea } from '@/app/_server/session';
import { canAccess } from '@/lib/navigation';
import { CrmOutboxTable } from '@/modules/crm/CrmOutboxTable';
import { ProblemReportForm } from '@/modules/system/ProblemReportForm';
import { SystemDiagnosticsPanel } from '@/modules/system/SystemDiagnosticsPanel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sistema' };

type PageData =
  | { readonly kind: 'ok'; readonly timeZone: string }
  | { readonly kind: 'startup-error'; readonly name: string; readonly message: string };

function loadPageData(): PageData {
  try {
    return { kind: 'ok', timeZone: getContainer().env.timeZone };
  } catch (error) {
    if (!isStartupError(error)) {
      throw error;
    }
    return { kind: 'startup-error', name: error.name, message: error.message };
  }
}

export default async function SistemaPage() {
  const session = await requireArea('sistema', '/sistema');
  if (!canAccess('admin', session.role)) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <ProblemReportForm variante="banco" />
      </div>
    );
  }
  const data = loadPageData();
  const timeZone = data.kind === 'ok' ? data.timeZone : 'Europe/Rome';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Sistema</h1>
        <p className="text-sm text-slate-600">
          Lo stato dei componenti da cui dipende l&apos;accettazione. Quando qualcosa non va, la
          segnalazione arriva all&apos;amministratore con il codice del controllo, chi l&apos;ha
          fatta e da quale postazione.
        </p>
      </header>

      {data.kind === 'startup-error' ? (
        <section
          className="border-status-no-show/30 bg-status-no-show-soft rounded-xl border p-6 shadow-sm"
          role="alert"
        >
          <h2 className="text-status-no-show-ink text-lg font-semibold">
            Configurazione non valida
          </h2>
          <p className="text-status-no-show-ink mt-2 text-sm">
            Il container non può essere costruito (<code>{data.name}</code>): {data.message}
          </p>
        </section>
      ) : (
        <SystemDiagnosticsPanel timeZone={timeZone} />
      )}

      <CrmOutboxTable timeZone={timeZone} />
    </div>
  );
}
