'use client';

// Form di cambio password: password attuale (quella provvisoria dettata dall'amministratore),
// nuova password e conferma. Invio a POST /api/v1/auth/change-password; il server rinnova il
// cookie e il browser prosegue verso la destinazione originaria.
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, postChangePassword, postLogout } from '@/lib/api-client/client';

export interface ChangePasswordFormProps {
  /** Dove andare a cambio riuscito (la pagina che si stava aprendo, o la home del ruolo). */
  readonly nextPath: string;
  /** True quando il cambio è imposto: niente "Annulla", solo "Esci". */
  readonly forced: boolean;
  readonly minLength: number;
}

export function ChangePasswordForm({ nextPath, forced, minLength }: ChangePasswordFormProps) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (newPassword.length < minLength) {
      setError(`La nuova password deve avere almeno ${minLength} caratteri.`);
      return;
    }
    if (newPassword !== confirm) {
      setError('Le due password non coincidono.');
      return;
    }
    setSubmitting(true);
    try {
      await postChangePassword({ currentPassword, newPassword });
      // Il cookie è cambiato: refresh dei Server Component perché il proxy rilegga la sessione.
      router.push(nextPath);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Impossibile contattare il server. Riprovare.',
      );
      setSubmitting(false);
    }
  };

  const esci = async (): Promise<void> => {
    try {
      await postLogout();
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password">Password attuale</Label>
            <Input
              id="current-password"
              name="current-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">Nuova password</Label>
            <Input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={minLength}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-describedby="new-password-hint"
            />
            <p id="new-password-hint" className="text-xs text-slate-500">
              Almeno {minLength} caratteri, diversa da quella attuale.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password">Ripeti la nuova password</Label>
            <Input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>

          {error !== null ? (
            <p
              role="alert"
              className="bg-status-no-show-soft rounded-md px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" variant="success" disabled={submitting}>
            {submitting ? 'Salvataggio in corso…' : 'Salva la nuova password'}
          </Button>
          {forced ? (
            <Button type="button" variant="ghost" onClick={() => void esci()}>
              Non sei tu? Esci
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={() => router.push(nextPath)}>
              Annulla
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
