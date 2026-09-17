'use client';

// Gestione degli operatori: tabella e form in una finestra. Il form serve sia a creare sia a
// modificare, così l'amministratore impara un solo schermo; il nome utente si imposta alla
// creazione e poi non si tocca (è la chiave dei log). La password provvisoria del reset si mostra
// una volta sola: chi la legge la detta al collega, e da quel momento esiste solo il suo hash.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateOperatorInput,
  OperatorView,
  UpdateOperatorInput,
} from '@/application/admin/OperatorAdminService';
import type { OperatorRole } from '@/domain/entities/operator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { TableSkeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ROLE_LABELS } from '@/components/shared/OperatorChip';
import {
  ApiError,
  fetchAdminOperators,
  patchAdminOperator,
  postAdminOperator,
  postAdminResetPassword,
} from '@/lib/api-client/client';

export interface OperatorsPanelProps {
  readonly currentOperatorId: string;
}

const RUOLI: readonly OperatorRole[] = ['ADVISOR', 'SUPERVISOR', 'ADMIN', 'KIOSK'];

interface FormState {
  readonly username: string;
  readonly displayName: string;
  readonly role: OperatorRole;
  readonly deskIds: readonly string[];
  readonly defaultWorkstationId: string;
  readonly password: string;
}

const FORM_VUOTO: FormState = {
  username: '',
  displayName: '',
  role: 'ADVISOR',
  deskIds: [],
  defaultWorkstationId: '',
  password: '',
};

export function OperatorsPanel({ currentOperatorId }: OperatorsPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-operators'] as const,
    queryFn: fetchAdminOperators,
  });
  const [editing, setEditing] = useState<OperatorView | 'nuovo' | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VUOTO);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [passwordProvvisoria, setPasswordProvvisoria] = useState<{
    operatore: string;
    password: string;
  } | null>(null);

  const apri = (op: OperatorView | 'nuovo'): void => {
    setErrore(null);
    setEditing(op);
    setForm(
      op === 'nuovo'
        ? FORM_VUOTO
        : {
            username: op.username,
            displayName: op.displayName,
            role: op.role,
            deskIds: op.deskIds,
            defaultWorkstationId: op.defaultWorkstationId ?? '',
            password: '',
          },
    );
  };

  const salva = async (): Promise<void> => {
    if (editing === null) {
      return;
    }
    setInCorso(true);
    setErrore(null);
    try {
      if (editing === 'nuovo') {
        const body: CreateOperatorInput = {
          username: form.username,
          displayName: form.displayName,
          role: form.role,
          deskIds: form.deskIds,
          defaultWorkstationId: form.defaultWorkstationId === '' ? null : form.defaultWorkstationId,
          password: form.password,
        };
        await postAdminOperator(body);
      } else {
        const body: UpdateOperatorInput = {
          displayName: form.displayName,
          role: form.role,
          deskIds: form.deskIds,
          defaultWorkstationId: form.defaultWorkstationId === '' ? null : form.defaultWorkstationId,
        };
        await patchAdminOperator(editing.id, body);
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-operators'] });
      setEditing(null);
    } catch (cause) {
      setErrore(cause instanceof ApiError ? cause.message : 'Salvataggio non riuscito.');
    } finally {
      setInCorso(false);
    }
  };

  const cambiaStato = async (op: OperatorView): Promise<void> => {
    setErrore(null);
    try {
      await patchAdminOperator(op.id, { isActive: !op.isActive });
      await queryClient.invalidateQueries({ queryKey: ['admin-operators'] });
    } catch (cause) {
      setErrore(cause instanceof ApiError ? cause.message : 'Operazione non riuscita.');
    }
  };

  const azzeraPassword = async (op: OperatorView): Promise<void> => {
    setErrore(null);
    try {
      const esito = await postAdminResetPassword(op.id);
      setPasswordProvvisoria({ operatore: op.displayName, password: esito.temporaryPassword });
      // La riga deve mostrare subito il segnale "Password provvisoria".
      await queryClient.invalidateQueries({ queryKey: ['admin-operators'] });
    } catch (cause) {
      setErrore(cause instanceof ApiError ? cause.message : 'Azzeramento non riuscito.');
    }
  };

  const data = query.data;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Utenti e accessi</h2>
          <p className="text-sm text-slate-600">
            Tutti gli account del sistema in un elenco solo — accettatori, BDC, amministratori e
            dispositivi kiosk — con le azioni sulla riga: modifica, reset della password,
            disattivazione. Un operatore disattivato non entra più, ma resta nei registri.
          </p>
        </div>
        <Button size="touch" onClick={() => apri('nuovo')}>
          Nuovo operatore
        </Button>
      </div>

      {errore !== null ? (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {errore}
        </p>
      ) : null}

      {query.isPending ? (
        <TableSkeleton rows={5} columns={6} label="Caricamento degli operatori" />
      ) : query.isError || data === undefined ? (
        <p role="alert" className="text-sm text-red-800">
          Elenco non disponibile: riprova fra qualche istante.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pt-3">Nome</TableHead>
              <TableHead className="pt-3">Utente</TableHead>
              <TableHead className="pt-3">Ruolo</TableHead>
              <TableHead className="pt-3">Sportelli</TableHead>
              <TableHead className="pt-3">Stato</TableHead>
              <TableHead className="pt-3">Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.operators.map((op) => (
              <TableRow key={op.id} className={op.isActive ? undefined : 'text-slate-500'}>
                <TableCell className="font-semibold text-slate-900">
                  {op.displayName}
                  {op.id === currentOperatorId ? (
                    <span className="ml-1 font-normal text-slate-500">(tu)</span>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono">{op.username}</TableCell>
                <TableCell>{ROLE_LABELS[op.role]}</TableCell>
                <TableCell>
                  {op.deskCodes.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    op.deskCodes.join(', ')
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {op.isActive ? (
                      <Badge tone="success">Attivo</Badge>
                    ) : (
                      <Badge tone="neutral">Inattivo</Badge>
                    )}
                    {op.mustChangePassword ? (
                      <Badge tone="warning" title="Deve cambiare la password al prossimo accesso">
                        Password provvisoria
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button size="touch" variant="outline" onClick={() => apri(op)}>
                      Modifica
                    </Button>
                    <Button size="touch" variant="ghost" onClick={() => void azzeraPassword(op)}>
                      Reset password
                    </Button>
                    <Button
                      size="touch"
                      variant={op.isActive ? 'destructive' : 'secondary'}
                      disabled={op.id === currentOperatorId}
                      onClick={() => void cambiaStato(op)}
                    >
                      {op.isActive ? 'Disattiva' : 'Riattiva'}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={editing !== null}
        title={editing === 'nuovo' ? 'Nuovo operatore' : `Modifica ${form.displayName}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Annulla
            </Button>
            <Button onClick={() => void salva()} disabled={inCorso}>
              {inCorso ? 'Salvataggio…' : 'Salva'}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void salva();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="op-username">Nome utente</Label>
            <Input
              id="op-username"
              value={form.username}
              disabled={editing !== 'nuovo'}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="nome.cognome"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="op-nome">Nome da mostrare</Label>
            <Input
              id="op-nome"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="op-ruolo">Ruolo</Label>
            <Select
              id="op-ruolo"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as OperatorRole })}
            >
              {RUOLI.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-slate-700">Sportelli assegnati</legend>
            <div className="flex flex-wrap gap-2">
              {(data?.desks ?? []).map((d) => {
                const scelto = form.deskIds.includes(d.id);
                return (
                  <label
                    key={d.id}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      scelto ? 'border-brand-secondary bg-slate-50' : 'border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={scelto}
                      onChange={() =>
                        setForm({
                          ...form,
                          deskIds: scelto
                            ? form.deskIds.filter((id) => id !== d.id)
                            : [...form.deskIds, d.id],
                        })
                      }
                    />
                    {d.code} · {d.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1">
            <Label htmlFor="op-postazione">Sportello predefinito</Label>
            <Select
              id="op-postazione"
              value={form.defaultWorkstationId}
              onChange={(e) => setForm({ ...form, defaultWorkstationId: e.target.value })}
            >
              <option value="">Nessuna (scelta al login)</option>
              {(data?.workstations ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          {editing === 'nuovo' ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="op-password">Password iniziale (almeno 8 caratteri)</Label>
              <Input
                id="op-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              La password si cambia con &ldquo;Reset password&rdquo; dalla tabella.
            </p>
          )}
        </form>
      </Dialog>

      <Dialog
        open={passwordProvvisoria !== null}
        title="Password provvisoria"
        description="Viene mostrata una volta sola: comunicala all'operatore adesso."
        onClose={() => setPasswordProvvisoria(null)}
        footer={<Button onClick={() => setPasswordProvvisoria(null)}>Ho preso nota</Button>}
      >
        {passwordProvvisoria !== null ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-700">
              Nuova password per <strong>{passwordProvvisoria.operatore}</strong>:
            </p>
            <p className="rounded-md bg-slate-100 px-4 py-3 text-center font-mono text-2xl font-bold tracking-widest">
              {passwordProvvisoria.password}
            </p>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
