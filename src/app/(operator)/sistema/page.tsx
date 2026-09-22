// Pagina Sistema (area autenticata): la diagnostica di tutto quello che può fermare l'officina —
// porte esterne, storage dei media, sincronizzazione, rete — con «Segnala ad Admin» accanto a
// ogni riga e una segnalazione libera per stampanti e hardware; per chi amministra, anche la
// coda di uscita verso il CRM. La diagnostica è un pannello client che si rilegge da solo: qui
// il server risolve sessione e configurazione, e dice se il container non si costruisce.
import type { Metadata } from 'next';
import { isStartupError } from '@/application/health/check-health';
import { getContainer } from '@/config/container';
import { requireArea } from '@/app/_server/session';
import { canAccess } from '@/lib/navigation';
import { CrmOutboxTable } from '@/modules/crm/CrmOutboxTable';
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

      {canAccess('admin', session.role) ? (
        <CrmOutboxTable timeZone={timeZone} />
      ) : (
        <p className="text-sm text-slate-500">
          La coda di uscita verso il CRM è visibile agli amministratori.
        </p>
      )}
    </div>
  );
}
