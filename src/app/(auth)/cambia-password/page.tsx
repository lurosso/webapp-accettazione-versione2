// Cambio password dell'operatore. Ci si arriva in due modi: obbligati, dopo la creazione
// dell'account o un reset dell'amministratore (il proxy e requireSession rimandano qui qualunque
// altra pagina), oppure di propria iniziativa. Serve una sessione: senza, si passa dal login.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSession } from '@/app/_server/session';
import { BrandMark } from '@/components/layout/BrandMark';
import { MIN_PASSWORD_LENGTH } from '@/config/constants';
import { destinationAfterPasswordChange } from '@/lib/navigation';
import { ChangePasswordForm } from '@/modules/reception/ChangePasswordForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Cambio password' };

interface ChangePasswordPageProps {
  readonly searchParams: Promise<{ readonly next?: string | string[] }>;
}

export default async function ChangePasswordPage({ searchParams }: ChangePasswordPageProps) {
  const [session, params] = await Promise.all([readSession(), searchParams]);
  if (session === null) {
    redirect('/login?next=%2Fcambia-password');
  }
  const destinazione = destinationAfterPasswordChange(params.next, session.role);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col items-center gap-2 text-center">
        <BrandMark className="text-2xl" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {session.mustChangePassword ? 'Scegli la tua password' : 'Cambia password'}
        </h1>
        <p className="text-sm text-slate-600">
          {session.mustChangePassword
            ? `Ciao ${session.displayName}: la password che ti è stata data è provvisoria e la conosce anche chi te l'ha comunicata. Scegline una tua per continuare.`
            : `${session.displayName}, inserisci la password attuale e quella nuova.`}
        </p>
      </header>
      <ChangePasswordForm
        nextPath={destinazione}
        forced={session.mustChangePassword}
        minLength={MIN_PASSWORD_LENGTH}
      />
    </main>
  );
}
