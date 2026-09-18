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
    <Card>
      <CardContent className="pt-6">
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
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
          {/*
           * La scelta della postazione offre SOLO quelle libere, e sotto mostra com'è messo il
           * banco adesso — tutte e quattro, con chi c'è sopra. Prima era una tendina con le
           * occupate dentro ma non selezionabili: per capire perché "la sua" non si sceglieva
           * bisognava aprire il menu e leggere le voci spente, e la riga di testo grigio sotto
           * diceva la stessa cosa una seconda volta, più piccola.
           */}
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-ink testo-corpo mb-1.5 font-semibold">Dove ti siedi</legend>
            {libere.length === 0 ? (
              <Notice tone="warning">
                Tutte le postazioni sono occupate. Chiedi a un collega di uscire dalla sua, oppure
                fatti scollegare da un amministratore.
              </Notice>
            ) : (
              <div className="flex flex-col gap-2">
                {libere.map((o) => (
                  <label
                    key={o.id}
                    className={cn(
                      'controllo transizione premibile flex cursor-pointer items-center gap-3 rounded-md border px-4',
                      o.id === workstationId
                        ? 'border-brand-secondary bg-surface-sunken text-ink font-semibold'
                        : 'border-line text-ink-soft hover:bg-surface-sunken',
                    )}
                  >
                    <input
                      type="radio"
                      name="workstation"
                      value={o.id}
                      checked={o.id === workstationId}
                      onChange={() => setWorkstationId(o.id)}
                      className="casella"
                    />
                    <span className="testo-corpo">{o.label}</span>
                  </label>
                ))}
              </div>
            )}
            {selected !== null && selected.brands.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Marchi serviti dallo sportello">
                {selected.brands.map((b) => (
                  <Badge key={b} tone="info">
                    {b}
                  </Badge>
                ))}
              </div>
            ) : null}
          </fieldset>

          {/* Com'è messo il banco adesso: si legge senza aprire niente, e si aggiorna da sé. */}
          {options.length > 0 ? (
            <section
              aria-label="Stato delle postazioni"
              className="border-line bg-surface-sunken/60 flex flex-col gap-2 rounded-md border p-3"
            >
              <h2 className="text-ink-soft testo-nota font-semibold tracking-wide uppercase">
                Le postazioni adesso
              </h2>
              <ul className="flex flex-col gap-1" aria-live="polite">
                {options.map((o) => (
                  <li key={o.id} className="testo-nota flex flex-wrap items-baseline gap-x-2">
                    <span className="text-ink font-semibold">{o.label}</span>
                    <span className={o.disabled ? 'text-status-in-progress-ink' : 'text-ink-muted'}>
                      {o.reason ?? 'libera'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-ink-muted testo-nota">
                Si scelgono solo le postazioni libere: due colleghi sullo stesso banco farebbero
                chiamare due clienti allo stesso sportello.
              </p>
            </section>
          ) : (
            <Notice tone="warning">
              Nessuna postazione configurata: un amministratore deve crearne almeno una.
            </Notice>
          )}

          {error !== null ? (
            <p
              role="alert"
              className="bg-status-no-show-soft text-status-no-show-ink rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? 'Accesso in corso…' : 'Accedi'}
          </Button>
        </form>

        {quickLoginProfiles.length > 0 ? (
          <section
            aria-label="Accesso veloce (solo sviluppo)"
            data-testid="accesso-veloce"
            className="border-status-in-progress bg-status-in-progress-soft text-status-in-progress-ink mt-6 rounded-md border border-dashed p-3 text-xs"
          >
            <p className="mb-2 font-semibold">
              Accesso veloce · solo sviluppo: entra con un profilo senza credenziali (account{' '}
              <code className="rounded bg-white/70 px-1">dev.*</code>, creati al primo uso).
            </p>
            <ul className="flex flex-wrap gap-2">
              {quickLoginProfiles.map((p) => (
                <li key={p.id}>
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    disabled={submitting}
                    title={p.description}
                    onClick={() => void accessoVeloce(p)}
                  >
                    {p.label}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {demoAccounts.length > 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-600">
            <p className="mb-2 font-semibold text-slate-700">
              Ambiente dimostrativo: password{' '}
              <code className="rounded bg-slate-100 px-1">demo</code> per tutti gli account.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {demoAccounts.map((account) => (
                <li key={account.username}>
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50"
                    onClick={() => {
                      setUsername(account.username);
                      setPassword('demo');
                    }}
                    title={`${account.displayName} (${ROLE_LABELS[account.role]})`}
                  >
                    {account.username} · {ROLE_LABELS[account.role]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
