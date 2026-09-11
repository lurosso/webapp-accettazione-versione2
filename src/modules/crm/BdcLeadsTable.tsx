'use client';

// Tabella dei lead del BDC: un cliente per riga, con tutto quello che serve per telefonargli.
// Il telefono è un link `tel:` come nel pannello di dettaglio: dal centralino o dal softphone la
// chiamata parte con un clic, senza ricopiare il numero.
import { useState } from 'react';
import type { BdcLeadView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

export interface BdcLeadsTableProps {
  readonly leads: readonly BdcLeadView[];
  readonly timeZone: string;
  /** Lead in corso di chiusura: il pulsante resta premuto finché il server non risponde. */
  readonly pendingId: string | null;
  readonly onContacted: (lead: BdcLeadView, note: string | null) => void;
}

/** Esito della consegna al CRM, spiegato al BDC senza gergo tecnico. */
function deliveryBadge(lead: BdcLeadView) {
  if (lead.handled) {
    return <Badge tone="success">Ricontattato</Badge>;
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

export function BdcLeadsTable({ leads, timeZone, pendingId, onContacted }: BdcLeadsTableProps) {
  // Nota facoltativa dell'esito: si apre solo sulla riga che si sta chiudendo, per non riempire
  // la tabella di caselle di testo che nessuno compila.
  const [noteAperte, setNoteAperte] = useState<Record<string, string>>({});

  if (leads.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        Nessun cliente da ricontattare: tutte le assenze di oggi sono state gestite.
      </p>
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
          return (
            <TableRow
              key={lead.eventId}
              className={cn(lead.handled ? 'bg-slate-50 text-slate-500' : 'hover:bg-slate-50')}
            >
              <TableCell className="font-mono font-bold whitespace-nowrap">
                {lead.code ?? '—'}
              </TableCell>
              <TableCell className="font-mono whitespace-nowrap tabular-nums">
                {lead.scheduledAt === null
                  ? '—'
                  : localTimeHHmm(new Date(lead.scheduledAt), timeZone)}
                {lead.deskCode !== null ? (
                  <span className="ml-2 text-xs text-slate-500">{lead.deskCode}</span>
                ) : null}
              </TableCell>
              <TableCell>
                <span className="font-semibold text-slate-900">{lead.customerName ?? '—'}</span>
                {lead.reason !== null ? (
                  <span className="block text-xs text-slate-500">{lead.reason}</span>
                ) : null}
              </TableCell>
              <TableCell className="font-mono whitespace-nowrap">
                {lead.phone === null ? (
                  <span className="text-slate-500">Non in agenda</span>
                ) : (
                  <a href={`tel:${lead.phone}`} className="font-semibold underline">
                    {lead.phone}
                  </a>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="font-mono font-semibold">{lead.plate ?? '—'}</span>
                {lead.vehicle !== null ? (
                  <span className="block text-xs text-slate-500">{lead.vehicle}</span>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap text-slate-600 tabular-nums">
                {localTimeHHmm(new Date(lead.detectedAt), timeZone)}
              </TableCell>
              <TableCell>
                {deliveryBadge(lead)}
                {lead.handled ? (
                  <span className="mt-1 block text-xs text-slate-500">
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
                  <span className="text-xs text-slate-400">Chiuso</span>
                ) : nota === undefined ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => onContacted(lead, null)}
                      disabled={pendingId === lead.eventId}
                    >
                      {pendingId === lead.eventId ? 'Salvo…' : 'Segna come ricontattato'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setNoteAperte((p) => ({ ...p, [lead.eventId]: '' }))}
                    >
                      Con esito
                    </Button>
                  </div>
                ) : (
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
                      className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={pendingId === lead.eventId}
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
