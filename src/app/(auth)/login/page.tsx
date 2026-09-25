// Pagina di login dell'accettatore: credenziali + scelta di Sportello (brand) e Postazione.
// Server Component: carica sportelli, postazioni e marchi dal container e li passa al form client.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSession } from '@/app/_server/session';
import { loadLoginOptions } from '@/app/_server/login-screen';
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
  // Le postazioni al primo caricamento; poi il form le richiede da sé ogni pochi secondi.
  const [options, operators] = await Promise.all([
    loadLoginOptions(container),
    container.repos.operators.listActive(),
  ]);
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
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col items-center gap-1 text-center">
        <BrandMark className="text-3xl" />
        <p className="text-ink-soft testo-corpo">Accettazione officina</p>
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
