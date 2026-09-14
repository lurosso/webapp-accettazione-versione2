'use client';

// Form di login: nome utente, password, Sportello (con i marchi serviti) e Accettazione.
// Le accettazioni proposte sono solo quelle libere; quelle occupate compaiono come nota, così chi
// arriva capisce perché "la sua" non c'è e a chi chiedere.
// Invio a POST /api/v1/auth/login; in caso di successo redirect alla dashboard (o a `next`).
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import type { OperatorRole } from '@/domain/entities/operator';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/components/shared/OperatorChip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError, postLogin } from '@/lib/api-client/client';

export interface DeskOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly brands: readonly string[];
}

export interface WorkstationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly deskId: string;
}

/** Accettazione non selezionabile, con il motivo ("in uso da Mario Rossi"). */
export interface OccupiedWorkstationOption {
  readonly id: string;
  readonly name: string;
  readonly deskId: string;
  readonly reason: string;
}

export interface DemoAccount {
  readonly username: string;
  readonly role: OperatorRole;
  readonly displayName: string;
}

export interface LoginFormProps {
  readonly desks: readonly DeskOption[];
  readonly workstations: readonly WorkstationOption[];
  readonly occupied?: readonly OccupiedWorkstationOption[];
  readonly nextPath: string;
  readonly demoAccounts: readonly DemoAccount[];
}

export function LoginForm({
  desks,
  workstations,
  occupied = [],
  nextPath,
  demoAccounts,
}: LoginFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [deskId, setDeskId] = useState(desks[0]?.id ?? '');
  const [workstationId, setWorkstationId] = useState(
    workstations.find((w) => w.deskId === (desks[0]?.id ?? ''))?.id ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const desk = desks.find((d) => d.id === deskId) ?? null;
  const deskWorkstations = useMemo(
    () => workstations.filter((w) => w.deskId === deskId),
    [workstations, deskId],
  );
  const deskOccupied = useMemo(
    () => occupied.filter((w) => w.deskId === deskId),
    [occupied, deskId],
  );

  const onDeskChange = (nextDeskId: string): void => {
    setDeskId(nextDeskId);
    const first = workstations.find((w) => w.deskId === nextDeskId);
    setWorkstationId(first?.id ?? '');
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (workstationId === '') {
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
            <Label htmlFor="desk">Sportello / Brand</Label>
            <Select
              id="desk"
              name="desk"
              value={deskId}
              onChange={(event) => onDeskChange(event.target.value)}
            >
              {desks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </Select>
            {desk !== null ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Marchi serviti dallo sportello">
                {desk.brands.map((b) => (
                  <Badge key={b} tone="info">
                    {b}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workstation">Accettazione</Label>
            <Select
              id="workstation"
              name="workstation"
              value={workstationId}
              onChange={(event) => setWorkstationId(event.target.value)}
              disabled={deskWorkstations.length === 0}
            >
              {deskWorkstations.length === 0 ? (
                <option value="">Nessuna accettazione libera per questo sportello</option>
              ) : null}
              {deskWorkstations.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            {deskOccupied.length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-xs text-slate-500" aria-live="polite">
                {deskOccupied.map((w) => (
                  <li key={w.id}>
                    <span className="font-medium text-slate-600">{w.name}</span>: {w.reason}
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
