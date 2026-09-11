'use client';

// Vista tablet dell'accettazione (modulo E): si usa in piedi accanto alle vetture, quindi niente
// tabella. Ogni pratica è una scheda alta con i dati che servono a riconoscere l'auto e un solo
// comando grande. Due schede: chi aspetta sul mio sportello e cosa ho già preso in carico io.
import { useState } from 'react';
import { effectiveScheduleTime } from '@/domain/entities/appointment';
import type { QueueRowView } from '@/domain/read-models';
import { compareByScheduleThenSequence } from '@/domain/value-objects/queue-code';
import type { Session } from '@/application/auth/IAuthService';
import { useAppointmentActions } from '@/hooks/useAppointmentActions';
import { useQueue } from '@/hooks/useQueue';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { CheckInScreen } from './CheckInScreen';

export interface TabletQueueProps {
  readonly session: Session;
  readonly homeDeskId: string | null;
}

type Scheda = 'attesa' | 'mie';

export function TabletQueue({ session, homeDeskId }: TabletQueueProps) {
  const [scheda, setScheda] = useState<Scheda>('attesa');
  const [inCheckIn, setInCheckIn] = useState<string | null>(null);
  const [conferma, setConferma] = useState<string | null>(null);

  const queue = useQueue({ date: null, deskId: homeDeskId, view: 'desk' });
  const actions = useAppointmentActions();
  const data = queue.data;

  const rows = data?.rows ?? [];
  const inAttesa = rows
    .filter((r) => r.appointment.status === 'WAITING' || r.appointment.status === 'SKIPPED')
    .sort((x, y) =>
      compareByScheduleThenSequence(
        { scheduledAt: effectiveScheduleTime(x.appointment), sequence: x.appointment.sequence },
        { scheduledAt: effectiveScheduleTime(y.appointment), sequence: y.appointment.sequence },
      ),
    );
  const mie = rows.filter(
    (r) =>
      r.appointment.status === 'IN_PROGRESS' && r.appointment.operatorId === session.operatorId,
  );
  const elenco = scheda === 'attesa' ? inAttesa : mie;

  const rigaInCheckIn = rows.find((r) => r.appointment.id === inCheckIn) ?? null;
  const brandName = (brandId: string): string =>
    data?.brands.find((b) => b.id === brandId)?.name ?? '';

  /** Dalla scheda "In attesa": prende in carico e apre subito l'ispezione. */
  const iniziaCheckIn = (row: QueueRowView): void => {
    setConferma(null);
    if (row.appointment.status === 'IN_PROGRESS') {
      setInCheckIn(row.appointment.id);
      return;
    }
    actions.run(row.appointment.id, { action: 'take', expectedVersion: row.appointment.version });
    setInCheckIn(row.appointment.id);
    setScheda('mie');
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Accettazione al veicolo</h1>
        <span className="text-base text-slate-600">
          {session.displayName}
          {data !== undefined
            ? ` · aggiornato alle ${localTimeHHmm(new Date(data.serverTime), data.timeZone)}`
            : ''}
        </span>
      </div>

      {conferma !== null ? (
        <p
          role="status"
          className="bg-status-completed-soft rounded-xl px-5 py-4 text-lg font-semibold text-emerald-900"
        >
          {conferma}
        </p>
      ) : null}

      {actions.outcome !== null ? (
        <p
          role="alert"
          className="bg-status-no-show-soft rounded-xl px-5 py-4 text-base text-red-900"
        >
          {actions.outcome.message}{' '}
          <button type="button" onClick={actions.clearOutcome} className="underline">
            Chiudi
          </button>
        </p>
      ) : null}

      {/* Schede grandi: si premono con il pollice tenendo il tablet in mano. */}
      <div role="tablist" aria-label="Elenco pratiche" className="grid grid-cols-2 gap-2">
        {(
          [
            { id: 'attesa' as const, label: 'In attesa', count: inAttesa.length },
            { id: 'mie' as const, label: 'Le mie prese in carico', count: mie.length },
          ] satisfies { id: Scheda; label: string; count: number }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={scheda === t.id}
            onClick={() => setScheda(t.id)}
            className={cn(
              'h-touch rounded-xl border-2 px-4 text-lg font-semibold transition-colors',
              scheda === t.id
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700',
            )}
          >
            {t.label}
            <span className="ml-2 font-normal opacity-80">({t.count})</span>
          </button>
        ))}
      </div>

      {queue.isPending ? (
        <p className="text-lg text-slate-500">Caricamento della coda…</p>
      ) : elenco.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-slate-300 px-5 py-10 text-center text-lg text-slate-500">
          {scheda === 'attesa'
            ? 'Nessun cliente in attesa su questo sportello.'
            : 'Non hai pratiche in lavorazione: aprine una dalla scheda "In attesa".'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {elenco.map((row) => {
            const a = row.appointment;
            const inLavorazione = a.status === 'IN_PROGRESS';
            return (
              <li
                key={a.id}
                className={cn(
                  'rounded-2xl border-2 bg-white p-4 shadow-sm',
                  inLavorazione
                    ? 'bg-status-in-progress-soft border-amber-400'
                    : 'border-slate-200',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="font-mono text-3xl font-black tracking-wide">{a.code}</span>
                      <span className="font-mono text-2xl font-bold text-slate-700">
                        {a.vehicle.plate}
                      </span>
                      <span className="font-mono text-lg text-slate-500 tabular-nums">
                        {data !== undefined
                          ? localTimeHHmm(new Date(effectiveScheduleTime(a)), data.timeZone)
                          : ''}
                      </span>
                    </div>
                    <span className="text-lg text-slate-700">
                      {brandName(a.brandId)} {a.vehicle.model} · {a.customer.lastName}{' '}
                      {a.customer.firstName}
                    </span>
                    {a.serviceDescription !== null ? (
                      <span className="text-base text-slate-500">{a.serviceDescription}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={actions.pendingId === a.id}
                    onClick={() => iniziaCheckIn(row)}
                    className={cn(
                      'h-touch shrink-0 rounded-xl px-6 text-lg font-bold shadow-sm disabled:opacity-60',
                      inLavorazione
                        ? 'bg-slate-900 text-white hover:bg-slate-700'
                        : 'bg-status-in-progress text-slate-900 hover:brightness-95',
                    )}
                  >
                    {actions.pendingId === a.id
                      ? 'Attendere…'
                      : inLavorazione
                        ? 'Riprendi check-in'
                        : 'Inizia check-in'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rigaInCheckIn !== null && data !== undefined ? (
        <CheckInScreen
          row={rigaInCheckIn}
          brandName={brandName(rigaInCheckIn.appointment.brandId)}
          timeZone={data.timeZone}
          onClose={() => setInCheckIn(null)}
          onCompleted={(codice, foto) => {
            setInCheckIn(null);
            setScheda('attesa');
            setConferma(
              `Check-in della pratica ${codice} completato${foto > 0 ? ` con ${foto} foto` : ''}. La campata è libera.`,
            );
          }}
        />
      ) : null}
    </div>
  );
}
