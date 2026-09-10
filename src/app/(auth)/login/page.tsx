// Pagina di login dell'accettatore: credenziali + scelta di Sportello (brand) e Postazione.
// Server Component: carica sportelli, postazioni e marchi dal container e li passa al form client.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { isDemoPasswordHash } from '@/lib/hash-password';
import {
  LoginForm,
  type DemoAccount,
  type DeskOption,
  type WorkstationOption,
} from '@/modules/reception/LoginForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Accesso' };

interface LoginPageProps {
  readonly searchParams: Promise<{ readonly next?: string | string[] }>;
}

/** Accetta solo percorsi interni (niente open redirect). */
function safeNextPath(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) {
    return '/accettazione';
  }
  return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, params] = await Promise.all([readSession(), searchParams]);
  const nextPath = safeNextPath(params.next);
  if (session !== null) {
    redirect(nextPath);
  }

  const container = getContainer();
  const [desks, workstations, brands, operators] = await Promise.all([
    container.repos.referenceData.listDesks(),
    container.repos.referenceData.listWorkstations(),
    container.repos.referenceData.listBrands(),
    container.repos.operators.listActive(),
  ]);

  const deskOptions: DeskOption[] = desks
    .filter((d) => d.isActive)
    .map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      brands: d.brandIds.map((id) => brands.find((b) => b.id === id)?.name ?? id),
    }));
  const workstationOptions: WorkstationOption[] = workstations.map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    deskId: w.deskId,
  }));
  // Suggerimenti visibili solo con il seed demo (mai in produzione: il container lo rifiuta).
  const demoAccounts: DemoAccount[] =
    container.env.nodeEnv === 'production'
      ? []
      : operators
          .filter((o) => isDemoPasswordHash(o.passwordHash))
          .map((o) => ({ username: o.username, role: o.role, displayName: o.displayName }));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col gap-1 text-center">
        <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">Autoclub Group</p>
        <h1 className="text-2xl font-bold tracking-tight">Accettazione Officina</h1>
        <p className="text-sm text-slate-600">
          Accedi con le tue credenziali e scegli la postazione.
        </p>
      </header>
      <LoginForm
        desks={deskOptions}
        workstations={workstationOptions}
        nextPath={nextPath}
        demoAccounts={demoAccounts}
      />
    </main>
  );
}
