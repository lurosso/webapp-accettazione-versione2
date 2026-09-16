// Pagina di login dell'accettatore: credenziali + scelta di Sportello (brand) e Postazione.
// Server Component: carica sportelli, postazioni e marchi dal container e li passa al form client.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSession } from '@/app/_server/session';
import { buildLoginOptions } from '@/application/auth/login-options';
import { workstationAvailability, type BusyBay } from '@/application/auth/workstation-availability';
import { getContainer } from '@/config/container';
import { BrandMark } from '@/components/layout/BrandMark';
import { isDemoPasswordHash } from '@/lib/hash-password';
import { homePathForRole, safeInternalPath } from '@/lib/navigation';
import { LoginForm, type DemoAccount } from '@/modules/reception/LoginForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Accesso' };

interface LoginPageProps {
  readonly searchParams: Promise<{ readonly next?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, params] = await Promise.all([readSession(), searchParams]);
  // Senza una destinazione esplicita si passa dalla radice, che smista ogni ruolo nella sua area
  // (accettatore, responsabile, amministratore) invece di mandare tutti in accettazione.
  const nextPath = safeInternalPath(params.next, '/');
  if (session !== null) {
    redirect(nextPath === '/' ? homePathForRole(session.role) : nextPath);
  }

  const container = getContainer();
  const now = container.clock.nowIso();
  const [desks, workstations, brands, operators, claims, inCarico] = await Promise.all([
    container.repos.referenceData.listDesks(),
    container.repos.referenceData.listWorkstations(),
    container.repos.referenceData.listBrands(),
    container.repos.operators.listActive(),
    container.repos.workstationClaims.listActive(now),
    container.repos.appointments.listByDate(container.clock.today(), {
      statuses: ['IN_PROGRESS'],
    }),
  ]);

  // Si propongono solo le accettazioni libere: né un collega collegato, né un veicolo in carico.
  const busyBays: BusyBay[] = inCarico
    .filter((a) => a.bayId !== null)
    .map((a) => ({
      bayId: a.bayId as string,
      code: a.code,
      operatorId: a.operatorId,
      operatorName:
        a.operatorId === null
          ? null
          : (operators.find((o) => o.id === a.operatorId)?.displayName ?? null),
    }));
  const disponibilita = workstationAvailability({ workstations, claims, busyBays, now });

  // Un solo menu: ogni accettazione porta con sé sportello e marchi; le occupate non si scelgono.
  const options = buildLoginOptions({
    workstations,
    desks: desks.filter((d) => d.isActive),
    brands,
    availability: disponibilita,
  });
  // Suggerimenti visibili solo con il seed demo (mai in produzione: il container lo rifiuta).
  const demoAccounts: DemoAccount[] =
    container.env.nodeEnv === 'production'
      ? []
      : operators
          .filter((o) => isDemoPasswordHash(o.passwordHash))
          .map((o) => ({ username: o.username, role: o.role, displayName: o.displayName }));

  // Accesso veloce (solo sviluppo): profili pronti, senza credenziali, per il debug.
  const quickLoginProfiles =
    container.devQuickLogin === null ? [] : await container.devQuickLogin.profiles();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col items-center gap-2 text-center">
        <BrandMark className="text-2xl" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Accettazione Officina</h1>
        <p className="text-sm text-slate-600">
          Accedi con le tue credenziali e scegli l&apos;accettazione.
        </p>
      </header>
      <LoginForm
        options={options}
        nextPath={nextPath}
        demoAccounts={demoAccounts}
        quickLoginProfiles={quickLoginProfiles}
      />
    </main>
  );
}
