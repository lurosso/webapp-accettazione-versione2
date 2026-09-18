'use client';

// Form di login: nome utente, password e la postazione. Ogni sportello porta con sé la propria
// area per marchio e i marchi che serve (badge sotto la scelta), quindi non c'è altro da scegliere.
//
// La scelta offre SOLO le postazioni libere, e sotto c'è com'è messo il banco adesso: tutte,
// con chi c'è sopra. Sono due domande diverse — «dove mi siedo» e «chi c'è agli altri banchi» —
// e prima erano la stessa tendina, con le occupate dentro ma spente. Chi arrivava e non trovava
// la sua doveva aprire il menu e leggere le voci grigie per capire il perché.
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { OperatorRole } from '@/domain/entities/operator';
import { defaultLoginOption, type LoginWorkstationOption } from '@/application/auth/login-options';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/components/shared/OperatorChip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { ApiError, postLogin, postQuickLogin } from '@/lib/api-client/client';
import { cn } from '@/lib/utils/cn';
import type { QuickLoginProfile } from '@/application/auth/DevQuickLoginService';

export interface DemoAccount {
  readonly username: string;
  readonly role: OperatorRole;
  readonly displayName: string;
}

export interface LoginFormProps {
  readonly options: readonly LoginWorkstationOption[];
  readonly nextPath: string;
  readonly demoAccounts: readonly DemoAccount[];
  /** Accesso veloce di sviluppo (DEV_QUICK_LOGIN): vuoto in produzione. */
  readonly quickLoginProfiles?: readonly QuickLoginProfile[];
}

export function LoginForm({
  options,
  nextPath,
  demoAccounts,
  quickLoginProfiles = [],
}: LoginFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [workstationId, setWorkstationId] = useState(() => defaultLoginOption(options));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = options.find((o) => o.id === workstationId) ?? null;
  const libere = options.filter((o) => !o.disabled);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (selected === null || selected.disabled) {
      setError('Selezionare uno sportello libero.');
      return;
    }
    setSubmitting(true);
    try {
      await postLogin({ username, password, workstationId });
      router.push(nextPath);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Impossibile contattare il server. Riprovare.',
      );
      setSubmitting(false);
    }
  };

  /** Accesso veloce: sessione di un profilo dev.* senza credenziali, poi la home del ruolo. */
  const accessoVeloce = async (profile: QuickLoginProfile): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      await postQuickLogin(profile.id);
      router.push(nextPath);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Impossibile contattare il server. Riprovare.',
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        {/*
         * Due colonne: a sinistra si entra, a destra si vede com'è messo il banco. Sono due
         * domande diverse — «dove mi siedo» e «chi c'è sugli altri» — e tenerle nella stessa
         * colonna voleva dire leggere la seconda per capire la prima.
         */}
        <CardContent className="grid gap-8 pt-6 md:grid-cols-[1fr_20rem]">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void onSubmit(event)}
            noValidate
          >
            <h1 className="text-2xl font-bold tracking-tight">Buongiorno</h1>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Nome utente</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {/* Il menu offre SOLO le libere: le occupate si vedono a destra, con il motivo. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workstation">Dove ti siedi</Label>
              <Select
                id="workstation"
                name="workstation"
                value={workstationId}
                onChange={(event) => setWorkstationId(event.target.value)}
                disabled={libere.length === 0}
              >
                {libere.length === 0 ? (
                  <option value="">Tutte le postazioni sono occupate</option>
                ) : null}
                {libere.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {selected !== null && selected.brands.length > 0 ? (
                <div className="flex flex-wrap gap-1.5" aria-label="Marchi serviti dallo sportello">
                  {selected.brands.map((b) => (
                    <Badge key={b} tone="neutral">
                      {b}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            {error !== null ? <Notice tone="error">{error}</Notice> : null}

            <Button type="submit" size="lg" disabled={submitting || libere.length === 0}>
              {submitting ? 'Accesso in corso…' : 'Entra'}
            </Button>
          </form>

          {/* Le postazioni adesso: il pallino dice lo stato prima che lo dica la parola. */}
          <aside
            aria-label="Stato delle postazioni"
            className="bg-surface-sunken/60 flex flex-col gap-3 rounded-lg p-4"
          >
            <h2 className="text-ink-soft testo-nota font-semibold tracking-wide uppercase">
              Le postazioni adesso
            </h2>
            <ul className="flex flex-col gap-2" aria-live="polite">
              {options.map((o) => (
                <li
                  key={o.id}
                  className={cn(
                    'bg-surface flex items-start gap-2.5 rounded-md px-3 py-2.5',
                    o.disabled && 'opacity-80',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1.5 size-2.5 shrink-0 rounded-full',
                      o.disabled ? 'bg-status-in-progress' : 'bg-status-completed',
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-ink testo-corpo font-semibold">{o.label}</span>
                    <span className="text-ink-muted testo-nota">{o.reason ?? 'libera'}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-ink-muted testo-nota">
              Si scelgono solo le postazioni libere: due colleghi sullo stesso banco farebbero
              chiamare due clienti allo stesso sportello.
            </p>
          </aside>
        </CardContent>
      </Card>

      {quickLoginProfiles.length > 0 ? (
        <section
          aria-label="Accesso veloce (solo sviluppo)"
          data-testid="accesso-veloce"
          className="border-status-in-progress/50 text-status-in-progress-ink flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3"
        >
          <p className="testo-nota font-semibold">Accesso veloce · solo sviluppo</p>
          <ul className="flex flex-wrap gap-2">
            {quickLoginProfiles.map((profilo) => (
              <li key={profilo.id}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  title={profilo.description}
                  onClick={() => void accessoVeloce(profilo)}
                >
                  {profilo.label}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {demoAccounts.length > 0 ? (
        <section className="border-line text-ink-muted flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3">
          <p className="testo-nota font-semibold">
            Ambiente dimostrativo · password{' '}
            <code className="bg-surface-sunken rounded px-1">demo</code>
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {demoAccounts.map((account) => (
              <li key={account.username}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setUsername(account.username);
                    setPassword('demo');
                  }}
                  title={`${account.displayName} (${ROLE_LABELS[account.role]})`}
                >
                  {account.username}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
