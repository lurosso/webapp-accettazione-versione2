'use client';

// Persone e postazioni: chi può entrare, con che ruolo, su quali sportelli — e dov'è adesso.
//
// Prima queste informazioni stavano in tre posti diversi: l'anagrafica qui, chi era collegato a
// quale campata nel pannello di monitoraggio, la scelta dello sportello in una terza griglia. Per
// rispondere a «chi sta lavorando alla campata 2 e come si chiama il suo account» un amministratore
// doveva guardare in tre punti e appaiare i nomi a mente. Una riga per persona, e la colonna
// «Dov'è adesso» tiene insieme le tre viste: l'unione è fatta sull'id dell'operatore, non sul nome,
// perché due colleghi omonimi non sono un'ipotesi da escludere in una concessionaria.
//
// Il monitoraggio è un di più: se la sua lettura fallisce l'elenco delle persone resta in piedi e
// la colonna dice «n/d». L'anagrafica non deve mai dipendere da una vista in tempo reale.
//
// La riga ha una sola azione, «Modifica»: reset della password e disattivazione erano due pulsanti
// su ogni riga — diciotto pulsanti in una tabella da sei persone — e adesso stanno dentro la scheda
// della persona, che è dove si va quando si vuole fare qualcosa a qualcuno.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StuckAppointmentView } from '@/application/admin/AssistanceService';
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
import { Panel, PanelHeader } from '@/components/ui/panel';
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
  fetchAssistance,
  patchAdminOperator,
  postAdminOperator,
  postAdminResetPassword,
} from '@/lib/api-client/client';
import { cn } from '@/lib/utils/cn';

export interface OperatorsPanelProps {
  readonly currentOperatorId: string;
}

const RUOLI: readonly OperatorRole[] = ['ADVISOR', 'SUPERVISOR', 'ADMIN', 'KIOSK'];

/** Dove si trova una persona in questo momento, ricavato dal monitoraggio degli sportelli. */
interface Postazione {
  readonly sportello: string;
  readonly pratica: StuckAppointmentView | null;
}

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
  // Stessa chiave del pannello di monitoraggio: una sola lettura per entrambe le schede.
  const monitoraggio = useQuery({
    queryKey: ['admin-assistance'] as const,
    queryFn: fetchAssistance,
    refetchInterval: 10_000,
  });
  const [editing, setEditing] = useState<OperatorView | 'nuovo' | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VUOTO);
  const [errore, setErrore] = useState<string | null>(null);
  const [ricerca, setRicerca] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [passwordProvvisoria, setPasswordProvvisoria] = useState<{
    operatore: string;
    password: string;
  } | null>(null);

  /** Operatore collegato → sportello occupato e pratica in lavorazione. */
  const postazioni = useMemo(() => {
    const mappa = new Map<string, Postazione>();
    for (const sportello of monitoraggio.data?.bays ?? []) {
      if (sportello.assignedOperatorId === null) {
        continue;
      }
      mappa.set(sportello.assignedOperatorId, {
        sportello: sportello.name,
        pratica: sportello.occupiedBy,
      });
    }
    return mappa;
  }, [monitoraggio.data]);

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
      setEditing(null);
    } catch (cause) {
      setErrore(cause instanceof ApiError ? cause.message : 'Operazione non riuscita.');
    }
  };

  const azzeraPassword = async (op: OperatorView): Promise<void> => {
    setErrore(null);
    try {
      const esito = await postAdminResetPassword(op.id);
      setEditing(null);
      setPasswordProvvisoria({ operatore: op.displayName, password: esito.temporaryPassword });
      // La riga deve mostrare subito il segnale "Password provvisoria".
      await queryClient.invalidateQueries({ queryKey: ['admin-operators'] });
    } catch (cause) {
      setErrore(cause instanceof ApiError ? cause.message : 'Azzeramento non riuscito.');
    }
  };

  const data = query.data;
  const monitoraggioRotto = monitoraggio.isError;

  /*
   * Con sei persone la ricerca non serve; con trenta, e con i kiosk in mezzo agli accettatori, è
   * l'unico modo di arrivare a una riga senza scorrere. Cerca su quello che uno ha in testa
   * mentre cerca: il nome, l'account, o la lettera dello sportello.
   */
  const cercato = ricerca.trim().toLowerCase();
  const elenco = useMemo(() => {
    const tutte = data?.operators ?? [];
    if (cercato === '') {
      return tutte;
    }
    return tutte.filter((op) =>
      [op.displayName, op.username, ROLE_LABELS[op.role], ...op.deskCodes]
        .join(' ')
        .toLowerCase()
        .includes(cercato),
    );
  }, [data?.operators, cercato]);

  return (
    <Panel>
      <PanelHeader
        title="Persone e postazioni"
        description="Tutti gli account del sistema in un elenco solo — accettatori, BDC, amministratori e dispositivi kiosk — con lo sportello a cui sono collegati adesso. Un operatore disattivato non entra più, ma resta nei registri."
        actions={
          <>
            <label className="sr-only" htmlFor="cerca-persona">
              Cerca una persona
            </label>
            <Input
              id="cerca-persona"
              type="search"
              value={ricerca}
              onChange={(event) => setRicerca(event.target.value)}
              placeholder="Cerca una persona"
              className="w-48"
            />
            <Button onClick={() => apri('nuovo')}>Nuova persona</Button>
          </>
        }
      />

      {errore !== null ? (
        <p
          role="alert"
          className="bg-status-no-show-soft text-status-no-show-ink mb-4 rounded-md px-4 py-3 text-sm"
        >
          {errore}
        </p>
      ) : null}

      {query.isPending ? (
        <TableSkeleton rows={5} columns={6} label="Caricamento delle persone" />
      ) : query.isError || data === undefined ? (
        <p role="alert" className="text-status-no-show-ink text-sm">
          Elenco non disponibile: riprova fra qualche istante.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Ruolo</TableHead>
              <TableHead>Sportelli</TableHead>
              <TableHead>Dov&apos;è adesso</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>
                <span className="sr-only">Azioni</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {elenco.map((op) => {
              const dove = postazioni.get(op.id);
              return (
                <TableRow key={op.id} className={op.isActive ? undefined : 'text-ink-muted'}>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      <span className={cn('font-semibold', op.isActive && 'text-ink')}>
                        {op.displayName}
                        {op.id === currentOperatorId ? (
                          <span className="text-ink-muted ml-1.5 font-normal">(tu)</span>
                        ) : null}
                      </span>
                      <span className="text-ink-muted font-mono text-xs">{op.username}</span>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{ROLE_LABELS[op.role]}</TableCell>
                  <TableCell>
                    {op.deskCodes.length === 0 ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {op.deskCodes.map((codice) => (
                          <span
                            key={codice}
                            className="bg-surface-sunken text-ink-soft rounded-sm px-2 py-0.5 text-xs font-semibold"
                          >
                            {codice}
                          </span>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {monitoraggioRotto ? (
                      <span className="text-ink-muted" title="Monitoraggio non raggiungibile">
                        n/d
                      </span>
                    ) : dove === undefined ? (
                      <span className="text-ink-muted">non collegato</span>
                    ) : (
                      <span className="flex flex-col gap-0.5">
                        <span className="text-ink font-medium">{dove.sportello}</span>
                        {dove.pratica === null ? (
                          <span className="text-ink-muted text-xs">
                            libero, nessuna pratica in corso
                          </span>
                        ) : (
                          <span className="text-status-in-progress-ink text-xs font-semibold">
                            <span className="font-mono">{dove.pratica.code}</span> ·{' '}
                            <span className="font-mono">{dove.pratica.plate}</span> da{' '}
                            {dove.pratica.minutesInProgress} min
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {op.isActive ? (
                        <Badge tone="success" dot>
                          Attivo
                        </Badge>
                      ) : (
                        <Badge tone="neutral" dot>
                          Inattivo
                        </Badge>
                      )}
                      {op.mustChangePassword ? (
                        <Badge tone="warning" title="Deve cambiare la password al prossimo accesso">
                          Password provvisoria
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => apri(op)}>
                      Modifica
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {elenco.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-ink-muted text-center">
                  Nessuna persona corrisponde a «{ricerca.trim()}».
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={editing !== null}
        title={editing === 'nuovo' ? 'Nuova persona' : `Modifica ${form.displayName}`}
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
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void salva();
          }}
        >
          <div className="flex flex-col gap-1.5">
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-nome">Nome da mostrare</Label>
            <Input
              id="op-nome"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
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
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-ink-soft mb-1.5 text-sm font-medium">
              Sportelli assegnati
            </legend>
            <div className="flex flex-wrap gap-2">
              {(data?.desks ?? []).map((d) => {
                const scelto = form.deskIds.includes(d.id);
                return (
                  <label
                    key={d.id}
                    className={cn(
                      'controllo transizione flex cursor-pointer items-center gap-2.5 rounded-md border px-3.5 text-sm',
                      scelto
                        ? 'border-brand-secondary bg-surface-sunken text-ink font-medium'
                        : 'border-line text-ink-soft',
                    )}
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
          <div className="flex flex-col gap-1.5">
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-password">Password iniziale (almeno 8 caratteri)</Label>
              <Input
                id="op-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          ) : null}
        </form>

        {/* Azioni sull'account: qui, non su ogni riga della tabella. Sono cose che si fanno a una
            persona precisa dopo averla aperta, non scorrendo l'elenco. */}
        {editing !== null && editing !== 'nuovo' ? (
          <div className="border-line-subtle mt-6 flex flex-col gap-3 border-t pt-5">
            <p className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
              Azioni sull&apos;account
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void azzeraPassword(editing)}
                title="Genera una password provvisoria, mostrata una volta sola"
              >
                Azzera la password
              </Button>
              <Button
                size="sm"
                variant={editing.isActive ? 'destructive' : 'secondary'}
                disabled={editing.id === currentOperatorId}
                onClick={() => void cambiaStato(editing)}
              >
                {editing.isActive ? 'Disattiva l’accesso' : 'Riattiva l’accesso'}
              </Button>
            </div>
            {editing.id === currentOperatorId ? (
              <p className="text-ink-muted text-xs">
                Non puoi disattivare il tuo stesso accesso: lo farebbe un altro amministratore.
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={passwordProvvisoria !== null}
        title="Password provvisoria"
        description="Viene mostrata una volta sola: comunicala alla persona adesso."
        onClose={() => setPasswordProvvisoria(null)}
        footer={<Button onClick={() => setPasswordProvvisoria(null)}>Ho preso nota</Button>}
      >
        {passwordProvvisoria !== null ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink-soft text-sm">
              Nuova password per{' '}
              <strong className="text-ink">{passwordProvvisoria.operatore}</strong>:
            </p>
            <p className="bg-surface-sunken text-ink rounded-md px-4 py-4 text-center font-mono text-2xl font-bold tracking-widest">
              {passwordProvvisoria.password}
            </p>
          </div>
        ) : null}
      </Dialog>
    </Panel>
  );
}
