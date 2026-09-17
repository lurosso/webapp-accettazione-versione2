'use client';

// Elenco delle pratiche per il check-in veicolo (modulo E): si usa in piedi accanto alle vetture,
// quindi niente tabella e niente intestazione del sito. Una barra minima (chi sei, dove sei,
// torna alla coda, esci), due schede grandi ("In attesa" del mio sportello, "Le mie prese in
// carico") e una scheda alta per ogni pratica con un solo comando. Da un PC la pagina non serve:
// si dice dove andare invece di mostrare una fotocamera che non c'è.
//
// Le schede sono tarate sui tablet piccoli (8-10 pollici, cioè 768-1024 px): tre blocchi separati
// e respirati — codice, targa e ora; veicolo e cliente; lavorazione richiesta — e il comando in
// fondo, a tutta larghezza, staccato dal testo da un bordo. Le descrizioni dei difetti arrivano da
// Infinity e possono essere lunghe una riga di terminale: si fermano a due righe e si aprono con
// "Mostra tutto", così una scheda non spinge fuori schermo tutte le altre.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  compareQueueOrder,
  effectiveScheduleTime,
  isDueWithinGrace,
} from '@/domain/entities/appointment';
import { visibleOnDesk } from '@/domain/queue-position';
import { LATE_GRACE_MINUTES } from '@/config/constants';
import type { QueueRowView } from '@/domain/read-models';
import type { Session } from '@/application/auth/IAuthService';
import { BrandMark } from '@/components/layout/BrandMark';
import { EmptyState } from '@/components/shared/EmptyState';
import { CardSkeleton } from '@/components/ui/skeleton';
import { useAppointmentActions } from '@/hooks/useAppointmentActions';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import { useTouchLayoutKind } from '@/hooks/useMediaQuery';
import { useQueue } from '@/hooks/useQueue';
import { queueKeys } from '@/lib/api-client/query-keys';
import { postLogout } from '@/lib/api-client/client';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { AppointmentDetailPanel } from '@/modules/reception/AppointmentDetailPanel';
import { deskOf } from '@/modules/reception/QueueTable';
import { CheckInScreen } from './CheckInScreen';

/**
 * Oltre questa lunghezza la lavorazione richiesta viene troncata a due righe con "Mostra tutto":
 * sotto ci sta in due righe anche su un tablet da 8 pollici, sopra no.
 */
const DESCRIZIONE_LUNGA = 90;

export interface CheckInQueueProps {
  readonly session: Session;
  readonly homeDeskId: string | null;
  /** "Sportello A": dove l'operatore ha fatto il login. */
  readonly workstationLabel: string;
  /**
   * Pratica da aprire subito in check-in (parametro `?pratica=`). È così che ci si arriva dalla
   * dashboard: presa in carico da tablet, oppure "Passa al check-in" dal dettaglio.
   */
  readonly openCheckInFor?: string | null;
}

type Scheda = 'attesa' | 'mie';

export function CheckInQueue({
  session,
  homeDeskId,
  workstationLabel,
  openCheckInFor = null,
}: CheckInQueueProps) {
  const router = useRouter();
  // Da un PC il check-in fotografico non si fa: la pagina lo dice invece di mostrare la fotocamera.
  const dispositivo = useTouchLayoutKind();
  const [scheda, setScheda] = useState<Scheda>('attesa');
  const [inCheckIn, setInCheckIn] = useState<string | null>(openCheckInFor);
  const [conferma, setConferma] = useState<string | null>(null);
  // Dettaglio della pratica aperto dal tocco sulla scheda, prima di prenderla in carico.
  const [dettaglio, setDettaglio] = useState<string | null>(null);
  // Pratica con la lavorazione richiesta aperta per intero (una alla volta: l'elenco resta corto).
  const [descrizioneAperta, setDescrizioneAperta] = useState<string | null>(null);
  const [uscita, setUscita] = useState(false);
  // Ricorda se il check-in è stato aperto dalla dashboard: uscendo si torna da dove si è arrivati.
  // Vale solo per quella prima apertura: i check-in aperti poi dall'elenco si chiudono e basta.
  const [daDashboard, setDaDashboard] = useState(openCheckInFor !== null);

  // La coda arriva completa (tutti gli sportelli) e viene filtrata qui: così il check-in si apre
  // anche su una pratica presa in carico dalla vista globale, che il filtro per sportello dello
  // stesso accettatore non restituirebbe.
  const queue = useQueue({ date: null, deskId: null, view: 'global' });
  // Anche il tablet sul piazzale sta sul flusso eventi: se un cliente tocca «sono arrivato» o un
  // collega prende in carico una pratica, l'elenco si aggiorna da solo. Il polling resta la rete
  // di sicurezza, ma nessuno deve ricaricare la pagina con le mani sporche.
  useLiveUpdates({
    url: '/api/v1/events/stream',
    types: [
      'APPOINTMENT_STATUS_CHANGED',
      'APPOINTMENT_CREATED',
      'CUSTOMER_ARRIVED',
      'CUSTOMER_LATE_NOTICE',
      'BUSINESS_DAY_CLOSED',
    ],
    invalidate: [queueKeys.all],
  });
  const actions = useAppointmentActions();
  const data = queue.data;

  const rows = data?.rows ?? [];
  // Lo sportello di una pratica è quello assegnato oppure quello che serve il marchio (le pratiche
  // della sync di Infinity nascono senza sportello): la stessa regola della dashboard. Il vecchio
  // confronto sul solo `deskId` lasciava il tablet vuoto con i dati reali. Le pratiche in attesa
  // con orario passato restano in elenco: le segna assenti solo l'operatore o la chiusura giornata.
  const delMioSportello = (r: QueueRowView): boolean =>
    visibleOnDesk(r.appointment, data?.desks ?? [], homeDeskId);
  const inAttesa = rows
    .filter(
      (r) =>
        delMioSportello(r) &&
        (r.appointment.status === 'WAITING' || r.appointment.status === 'SKIPPED'),
    )
    .sort((x, y) => compareQueueOrder(x.appointment, y.appointment));
  const mie = rows.filter(
    (r) =>
      r.appointment.status === 'IN_PROGRESS' && r.appointment.operatorId === session.operatorId,
  );
  const elenco = scheda === 'attesa' ? inAttesa : mie;

  const rigaInCheckIn = rows.find((r) => r.appointment.id === inCheckIn) ?? null;
  // Pratica richiesta ma non più in elenco (chiusa da un collega, giornata cambiata): meglio
  // dirlo che lasciare l'operatore davanti a una schermata che non si apre.
  const richiestaAssente =
    openCheckInFor !== null && data !== undefined && rigaInCheckIn === null && inCheckIn !== null;

  // L'indirizzo torna pulito una volta aperto il check-in: ricaricando non si riapre da capo.
  useEffect(() => {
    if (openCheckInFor !== null) {
      router.replace('/check-in', { scroll: false });
    }
  }, [openCheckInFor, router]);

  /**
   * Uscita dal check-in senza concluderlo: la pratica resta in carico e le foto già scattate
   * restano nel fascicolo. Arrivando dalla dashboard si torna alla coda, cioè da dove si è
   * partiti; aprendo il check-in dall'elenco si chiude solo la schermata.
   */
  const esciDalCheckIn = (): void => {
    setInCheckIn(null);
    if (daDashboard) {
      setDaDashboard(false);
      router.push('/accettazione');
    }
  };
  const brandName = (brandId: string): string =>
    data?.brands.find((b) => b.id === brandId)?.name ?? '';

  /** Dalla scheda "In attesa": prende in carico e apre subito il check-in. */
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

  const esci = async (): Promise<void> => {
    setUscita(true);
    try {
      await postLogout();
    } finally {
      window.location.href = new URL('/login', window.location.origin).toString();
    }
  };

  if (dispositivo === 'unknown') {
    return null;
  }
  if (dispositivo === 'desktop') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6">
        <EmptyState
          size="page"
          title="Il check-in fotografico si fa dal tablet"
          description="Da un PC non si scattano foto. La presa in carico e i dettagli della pratica sono nella coda accettazione; il giro fotografico del veicolo si apre dal tablet sul piazzale."
          actions={
            <Link
              href="/accettazione"
              className="bg-brand-secondary hover:bg-brand-blue-dark premibile focus-anello controllo inline-flex items-center rounded-md px-4 text-sm font-semibold text-white"
            >
              Vai alla coda accettazione
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Barra minima: chi sei e dove sei, più le due uscite. Nessun'altra navigazione. */}
      <header className="border-brand-lime bg-brand-blue-dark border-b-4 text-white">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <BrandMark tone="light" className="text-base" />
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold">Check-in veicolo</span>
              <span className="text-sm text-white/80">
                {session.displayName} · {workstationLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/accettazione"
              className="premibile controllo focus-anello inline-flex items-center rounded-xl border-2 border-white/40 px-4 text-base font-semibold text-white [--anello-colore:#fff] hover:bg-white/10"
            >
              Coda
            </Link>
            <button
              type="button"
              onClick={() => void esci()}
              disabled={uscita}
              className="premibile controllo focus-anello inline-flex items-center rounded-xl bg-white/15 px-4 text-base font-semibold text-white [--anello-colore:#fff] hover:bg-white/25 disabled:opacity-60"
            >
              {uscita ? 'Uscita…' : 'Esci'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-5 md:px-6 md:py-6">
        {conferma !== null ? (
          <p
            role="status"
            className="bg-status-completed-soft text-status-completed-ink rounded-2xl px-5 py-4 text-lg font-semibold"
          >
            {conferma}
          </p>
        ) : null}

        {richiestaAssente ? (
          <p
            role="alert"
            className="bg-status-skipped-soft text-status-skipped-ink rounded-2xl px-5 py-4 text-base"
          >
            La pratica richiesta non è più in elenco: potrebbe essere stata chiusa o annullata da un
            collega. Scegline una dall&apos;elenco qui sotto.
          </p>
        ) : null}

        {actions.outcome !== null ? (
          <p
            role="alert"
            className="bg-status-no-show-soft text-status-no-show-ink rounded-2xl px-5 py-4 text-base"
          >
            {actions.outcome.message}{' '}
            <button type="button" onClick={actions.clearOutcome} className="underline">
              Chiudi
            </button>
          </p>
        ) : null}

        {/* Schede grandi: si premono con il pollice tenendo il tablet in mano. */}
        <div
          role="tablist"
          aria-label="Elenco pratiche"
          className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-200 p-1"
        >
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
                'controllo-lg transizione focus-anello rounded-xl px-4 text-lg font-semibold',
                scheda === t.id
                  ? 'bg-brand-secondary text-white shadow-sm'
                  : 'text-slate-700 hover:bg-white/60',
              )}
            >
              {t.label}
              <span className="ml-2 font-normal opacity-80">({t.count})</span>
            </button>
          ))}
        </div>

        {queue.isPending ? (
          <CardSkeleton count={3} label="Caricamento della coda" />
        ) : elenco.length === 0 ? (
          <EmptyState
            size="page"
            title={
              scheda === 'attesa'
                ? 'Nessun cliente in attesa su questo sportello'
                : 'Nessuna pratica in lavorazione'
            }
            description={
              scheda === 'attesa'
                ? 'Quando arriva una nuova pratica compare qui da sola.'
                : 'Aprine una dalla scheda "In attesa": la presa in carico apre subito il check-in.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {elenco.map((row) => {
              const a = row.appointment;
              const inLavorazione = a.status === 'IN_PROGRESS';
              // Orario atteso superato ma entro la tolleranza: scheda gialla, da servire ora.
              const daServire =
                data !== undefined && isDueWithinGrace(a, data.serverTime, LATE_GRACE_MINUTES);
              const descrizione = a.serviceDescription;
              const apribile = descrizione !== null && descrizione.length > DESCRIZIONE_LUNGA;
              const aperta = descrizioneAperta === a.id;
              return (
                <li
                  key={a.id}
                  className={cn(
                    'overflow-hidden rounded-2xl border-2 bg-white shadow-sm',
                    inLavorazione
                      ? 'bg-status-in-progress-soft border-status-in-progress'
                      : daServire
                        ? 'border-priority-now bg-priority-now-soft'
                        : 'border-line',
                  )}
                >
                  {/* Tutta l'area informativa apre il dettaglio; il comando sta staccato, sotto. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Apri i dettagli della pratica ${a.code}`}
                    onClick={() => setDettaglio(a.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDettaglio(a.id);
                      }
                    }}
                    className="flex cursor-pointer flex-col gap-3 p-5 select-none"
                  >
                    {/* Codice e targa si leggono da un metro; l'ora sta all'estremo opposto. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="font-mono text-3xl leading-none font-black tracking-wide md:text-4xl">
                        {a.code}
                      </span>
                      <span className="rounded-md border-2 border-slate-900 bg-white px-2 py-0.5 font-mono text-xl leading-none font-bold tracking-widest text-slate-900 md:text-2xl">
                        {a.vehicle.plate}
                      </span>
                      <span className="ml-auto font-mono text-xl leading-none text-slate-500 tabular-nums">
                        {data !== undefined
                          ? localTimeHHmm(new Date(effectiveScheduleTime(a)), data.timeZone)
                          : ''}
                      </span>
                    </div>

                    {/* Veicolo e cliente su due righe: a 768 px una riga sola andava a capo male. */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xl leading-snug font-semibold text-slate-900">
                        {brandName(a.brandId)} {a.vehicle.model}
                      </span>
                      <span className="text-lg leading-snug text-slate-600">
                        {a.customer.lastName} {a.customer.firstName}
                      </span>
                    </div>

                    {descrizione !== null ? (
                      <div className="flex flex-col items-start gap-1">
                        <p
                          className={cn(
                            'text-base leading-snug text-slate-600',
                            apribile && !aperta && 'line-clamp-2',
                          )}
                        >
                          {descrizione}
                        </p>
                        {apribile ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDescrizioneAperta(aperta ? null : a.id);
                            }}
                            aria-expanded={aperta}
                            className="text-brand-secondary focus-anello controllo -mx-2 inline-flex items-center rounded-md px-2 text-base font-semibold underline underline-offset-4"
                          >
                            {aperta ? 'Mostra meno' : 'Mostra tutto'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {/* Il cliente ha toccato «sono arrivato»: è in fila fuori, e chi sceglie chi
                          chiamare lo vede senza aprire il dettaglio. */}
                      {a.customerArrivedAt !== null ? (
                        <span
                          className="text-status-completed-ink text-sm font-semibold"
                          data-testid="cliente-in-fila"
                        >
                          in fila dalle{' '}
                          {data !== undefined
                            ? localTimeHHmm(new Date(a.customerArrivedAt), data.timeZone)
                            : ''}
                        </span>
                      ) : null}
                      {daServire ? (
                        <span className="text-priority-now-ink text-sm font-semibold">
                          orario superato · da servire ora
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Comando in fondo, a tutta larghezza e separato: niente tocchi per sbaglio. */}
                  <div className="border-t-2 border-slate-100 bg-slate-50/70 p-4">
                    <button
                      type="button"
                      disabled={actions.pendingId === a.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        iniziaCheckIn(row);
                      }}
                      className={cn(
                        'controllo-lg premibile focus-anello w-full rounded-xl px-6 text-xl font-bold shadow-sm disabled:opacity-60',
                        // Blu in entrambi i casi: prendere in carico e riprendere sono azioni di
                        // lavoro; il verde è riservato a "Completa check-in".
                        inLavorazione
                          ? 'border-brand-secondary text-brand-secondary border-2 bg-white hover:bg-slate-50'
                          : 'bg-brand-secondary hover:bg-brand-blue-dark text-white',
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
      </main>

      {data !== undefined ? (
        <AppointmentDetailPanel
          row={rows.find((r) => r.appointment.id === dettaglio) ?? null}
          presentation="modal"
          allowCheckIn
          showTake
          brandName={(() => {
            const r = rows.find((x) => x.appointment.id === dettaglio);
            return r === undefined ? '' : brandName(r.appointment.brandId);
          })()}
          deskLabel={(() => {
            const r = rows.find((x) => x.appointment.id === dettaglio);
            const desk = r === undefined ? null : deskOf(r, data.desks);
            return desk === null ? null : `${desk.code} · ${desk.name}`;
          })()}
          timeZone={data.timeZone}
          currentOperatorName={session.displayName}
          actionPending={dettaglio !== null && actions.pendingId === dettaglio}
          onClose={() => setDettaglio(null)}
          onAction={(action) => {
            const r = rows.find((x) => x.appointment.id === dettaglio);
            if (r === undefined) {
              return;
            }
            if (action === 'take') {
              setDettaglio(null);
              iniziaCheckIn(r);
              return;
            }
            actions.run(r.appointment.id, { action, expectedVersion: r.appointment.version });
          }}
        />
      ) : null}

      {rigaInCheckIn !== null && data !== undefined ? (
        <CheckInScreen
          row={rigaInCheckIn}
          brandName={brandName(rigaInCheckIn.appointment.brandId)}
          timeZone={data.timeZone}
          onClose={esciDalCheckIn}
          onSkip={esciDalCheckIn}
          onCompleted={(codice, media) => {
            setInCheckIn(null);
            setDaDashboard(false);
            setScheda('attesa');
            setConferma(
              `Check-in della pratica ${codice} completato${media > 0 ? ` con ${media} file` : ' senza foto né video'}. Lo sportello è libero.`,
            );
          }}
        />
      ) : null}
    </div>
  );
}
