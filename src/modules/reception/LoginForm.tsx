'use client';

// Form di login: nome utente, password e UN solo menu, l'accettazione. Ogni accettazione porta
// con sé il proprio sportello e i marchi che serve (badge sotto al menu), quindi non c'è più
// niente da scegliere prima. Le accettazioni occupate restano in elenco ma non selezionabili,
// con il motivo accanto: chi arriva capisce perché "la sua" non c'è e a chi chiedere.
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
import { Select } from '@/components/ui/select';
import { ApiError, postLogin } from '@/lib/api-client/client';

export interface DemoAccount {
  readonly username: string;
  readonly role: OperatorRole;
  readonly displayName: string;
}

export interface LoginFormProps {
  readonly options: readonly LoginWorkstationOption[];
  readonly nextPath: string;
  readonly demoAccounts: readonly DemoAccount[];
}

export function LoginForm({ options, nextPath, demoAccounts }: LoginFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [workstationId, setWorkstationId] = useState(() => defaultLoginOption(options));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = options.find((o) => o.id === workstationId) ?? null;
  const occupied = options.filter((o) => o.disabled);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (selected === null || selected.disabled) {
      setError("Selezionare un'accettazione libera.");
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workstation">Accettazione</Label>
            <Select
              id="workstation"
              name="workstation"
              value={workstationId}
              onChange={(event) => setWorkstationId(event.target.value)}
              disabled={options.length === 0}
            >
              {options.length === 0 ? (
                <option value="">Nessuna accettazione configurata</option>
              ) : null}
              {workstationId === '' && options.length > 0 ? (
                <option value="">Tutte le accettazioni sono occupate</option>
              ) : null}
              {options.map((o) => (
                <option key={o.id} value={o.id} disabled={o.disabled}>
                  {o.label}
                  {o.reason !== null ? ` — ${o.reason}` : ''}
                </option>
              ))}
            </Select>
            {selected !== null && selected.brands.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Marchi serviti dall'accettazione">
                {selected.brands.map((b) => (
                  <Badge key={b} tone="info">
                    {b}
                  </Badge>
                ))}
              </div>
            ) : null}
            {occupied.length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-xs text-slate-500" aria-live="polite">
                {occupied.map((o) => (
                  <li key={o.id}>
                    <span className="font-medium text-slate-600">{o.label}</span>: {o.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {error !== null ? (
            <p
              role="alert"
              className="bg-status-no-show-soft rounded-md px-3 py-2 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? 'Accesso in corso…' : 'Accedi'}
          </Button>
        </form>

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
