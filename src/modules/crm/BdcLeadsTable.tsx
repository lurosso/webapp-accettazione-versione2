'use client';

// Tabella dei lead del BDC: un cliente per riga, con tutto quello che serve per telefonargli.
// Il telefono è un link `tel:` come nel pannello di dettaglio: dal centralino o dal softphone la
// chiamata parte con un clic, senza ricopiare il numero.
//
// Chiudere un lead lo toglie dall'elenco delle chiamate da fare, e non è una cosa che si disfa da
// sola: il comando è un `HoldButton`, la stessa difesa che sta sulla coda. Prima c'era qui una
// conferma in due tocchi scritta a mano, con il suo timer: identica nell'intento, diversa nei
// dettagli: un comportamento solo, in un posto solo.
import { useState } from 'react';
import type { BdcLeadView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoldButton } from '@/components/ui/hold-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTimeIt, localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { EmptyState } from '@/components/shared/EmptyState';

export interface BdcLeadsTableProps {
  readonly leads: readonly BdcLeadView[];
  readonly timeZone: string;
  /** Lead in corso di chiusura: il pulsante resta premuto finché il server non risponde. */
  readonly pendingId: string | null;
  readonly onContacted: (lead: BdcLeadView, note: string | null) => void;
  /** Riporta un lead chiuso fra quelli da fare (tocco sbagliato, riprogrammazione saltata). */
  readonly onReopen: (lead: BdcLeadView) => void;
}

/** Esito della consegna al CRM, spiegato al BDC senza gergo tecnico. */
function deliveryBadge(lead: BdcLeadView) {
  if (lead.handled) {
    return <Badge tone="success">Gestito</Badge>;
  }
  switch (lead.deliveryStatus) {
    case 'SENT':
      return <Badge tone="info">Inviato al CRM</Badge>;
    case 'FAILED':
      return <Badge tone="danger">CRM non raggiungibile</Badge>;
    default:
      return <Badge tone="warning">In attesa di invio</Badge>;
  }
}

export function BdcLeadsTable({
  leads,
  timeZone,
  pendingId,
  onContacted,
  onReopen,
}: BdcLeadsTableProps) {
  // Nota facoltativa dell'esito: si apre solo sulla riga che si sta chiudendo, per non riempire
  // la tabella di caselle di testo che nessuno compila.
  const [noteAperte, setNoteAperte] = useState<Record<string, string>>({});

  if (leads.length === 0) {
    return (
      <EmptyState
        title="Nessun cliente da ricontattare"
        description="Tutte le assenze della giornata sono state gestite e riprogrammate. Un nuovo assente compare qui entro pochi secondi."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pt-3">Codice</TableHead>
          <TableHead className="pt-3">Appuntamento</TableHead>
          <TableHead className="pt-3">Cliente</TableHead>
          <TableHead className="pt-3">Telefono</TableHead>
          <TableHead className="pt-3">Veicolo</TableHead>
          <TableHead className="pt-3">Assenza</TableHead>
          <TableHead className="pt-3">Stato</TableHead>
          <TableHead className="pt-3">Azioni</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => {
          const nota = noteAperte[lead.eventId];
          const inCorso = pendingId === lead.eventId;
          const chiCercare = lead.customerName ?? lead.plate ?? lead.code ?? 'questo cliente';
          return (
            <TableRow
              key={lead.eventId}
              className={cn(
                lead.handled ? 'bg-surface-sunken text-ink-muted' : 'hover:bg-surface-sunken',
              )}
            >
              <TableCell className="testo-dato font-mono font-bold whitespace-nowrap">
                {lead.code ?? '—'}
              </TableCell>
              <TableCell className="font-mono whitespace-nowrap tabular-nums">
                {lead.scheduledAt === null
                  ? '—'
                  : localTimeHHmm(new Date(lead.scheduledAt), timeZone)}
                {lead.deskCode !== null ? (
                  <span className="text-ink-muted testo-nota ml-2">{lead.deskCode}</span>
                ) : null}
              </TableCell>
              <TableCell>
                <span className="font-semibold">{lead.customerName ?? '—'}</span>
                {lead.reason !== null ? (
                  <span className="text-ink-muted testo-nota block">{lead.reason}</span>
                ) : null}
              </TableCell>
              <TableCell className="font-mono whitespace-nowrap">
                {lead.phone === null ? (
                  <span className="text-ink-muted">Non in agenda</span>
                ) : (
                  // Il numero è il motivo per cui questa riga esiste: si punta col dito, quindi è
                  // alto quanto un comando, non quanto una riga di testo.
                  <a
                    href={`tel:${lead.phone}`}
                    className="focus-anello controllo -mx-2 inline-flex items-center rounded-md px-2 font-semibold underline"
                  >
                    {lead.phone}
                  </a>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="font-mono font-semibold">{lead.plate ?? '—'}</span>
                {lead.vehicle !== null ? (
                  <span className="text-ink-muted testo-nota block">{lead.vehicle}</span>
                ) : null}
              </TableCell>
              <TableCell className="text-ink-soft whitespace-nowrap tabular-nums">
                {localTimeHHmm(new Date(lead.detectedAt), timeZone)}
              </TableCell>
              <TableCell>
                {deliveryBadge(lead)}
                {lead.handled ? (
                  <span className="text-ink-muted testo-nota mt-1 block">
                    {lead.handledByName ?? 'BDC'}
                    {lead.handledAt === null
                      ? ''
                      : ` · ${formatDateTimeIt(lead.handledAt, timeZone)}`}
                    {lead.handledNote === null ? '' : ` · ${lead.handledNote}`}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                {lead.handled ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={inCorso}
                    onClick={() => onReopen(lead)}
                  >
                    {inCorso ? 'Riapro…' : 'Riporta fra i da fare'}
                  </Button>
                ) : nota === undefined ? (
                  <div className="flex flex-wrap gap-2">
                    {/* Col dito si tiene premuto, al banco si clicca due volte: la riga non esce
                        dall'elenco perché il pollice l'ha sfiorata mentre si scorreva. */}
                    <HoldButton
                      variant="success"
                      size="sm"
                      disabled={inCorso}
                      confirmLabel="Confermi? Esce dalla lista"
                      actionLabel={`Segna come gestito il lead di ${chiCercare}`}
                      onConfirm={() => onContacted(lead, null)}
                    >
                      {inCorso ? 'Salvo…' : 'Gestito / riprogrammato'}
                    </HoldButton>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setNoteAperte((p) => ({ ...p, [lead.eventId]: '' }))}
                    >
                      Con nota
                    </Button>
                  </div>
                ) : (
                  // Con la nota davanti la conferma non serve: scrivere l'esito è già un gesto
                  // deliberato, e chiederne un secondo sarebbe solo un ostacolo.
                  <div className="flex flex-col gap-2">
                    <label className="sr-only" htmlFor={`esito-${lead.eventId}`}>
                      Esito della telefonata
                    </label>
                    <input
                      id={`esito-${lead.eventId}`}
                      value={nota}
                      maxLength={500}
                      autoFocus
                      placeholder="Es. richiamare domani mattina"
                      onChange={(event) =>
                        setNoteAperte((p) => ({ ...p, [lead.eventId]: event.target.value }))
                      }
                      className="border-line focus-anello controllo testo-corpo w-56 rounded-md border px-3"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="success"
                        disabled={inCorso}
                        onClick={() => onContacted(lead, nota.trim() === '' ? null : nota.trim())}
                      >
                        Salva e chiudi
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setNoteAperte((p) => {
                            const { [lead.eventId]: _rimossa, ...resto } = p;
                            return resto;
                          })
                        }
                      >
                        Annulla
                      </Button>
                    </div>
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
