'use client';

// "Nuovo cliente (senza appuntamento)": il form rapido con cui l'accettatore mette in coda chi si
// presenta senza prenotazione, o chi in agenda non è arrivato. Quattro campi che si compilano al
// banco in trenta secondi; il resto (codice, orario, sportello) lo decide il server.
import { useState, type FormEvent } from 'react';
import type { Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError, postManualAppointment } from '@/lib/api-client/client';

export interface NewWalkInDialogProps {
  readonly open: boolean;
  readonly brands: readonly Brand[];
  /** Marca proposta: la prima servita dallo sportello dell'operatore. */
  readonly defaultBrandId: string | null;
  /** Sportello dell'operatore, se ne ha uno: la pratica finisce nella sua coda. */
  readonly deskId: string | null;
  readonly onClose: () => void;
  readonly onCreated: (appointment: Appointment) => void;
}

export function NewWalkInDialog({
  open,
  brands,
  defaultBrandId,
  deskId,
  onClose,
  onCreated,
}: NewWalkInDialogProps) {
  const attivi = brands.filter((b) => b.isActive);
  const [plate, setPlate] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [brandScelta, setBrandScelta] = useState<string | null>(null);
  const brandId = brandScelta ?? defaultBrandId ?? attivi[0]?.id ?? '';
  const [service, setService] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = (): void => {
    setPlate('');
    setCustomerName('');
    setPhone('');
    setService('');
    setError(null);
  };

  const chiudi = (): void => {
    reset();
    onClose();
  };

  const salva = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (plate.trim() === '' || customerName.trim() === '') {
      setError('Targa e nome del cliente sono obbligatori.');
      return;
    }
    setSaving(true);
    try {
      const { appointment } = await postManualAppointment({
        plate: plate.trim(),
        customerName: customerName.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        brandId,
        deskId,
        serviceDescription: service.trim() === '' ? null : service.trim(),
        whatsappOptIn,
      });
      reset();
      onCreated(appointment);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Impossibile salvare la pratica. Riprovare.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Nuovo cliente senza appuntamento"
      description="La pratica entra subito nella coda di oggi con il prossimo codice, dietro a chi era prenotato prima. Il cliente riceve la conferma con il codice, se ha lasciato un telefono."
      onClose={chiudi}
    >
      <form id="nuovo-cliente" className="flex flex-col gap-4" onSubmit={(e) => void salva(e)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wi-targa">Targa</Label>
            <Input
              id="wi-targa"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="AB123CD"
              autoFocus
              required
              autoComplete="off"
              className="font-mono text-lg tracking-widest uppercase"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wi-marca">Marca</Label>
            <Select id="wi-marca" value={brandId} onChange={(e) => setBrandScelta(e.target.value)}>
              {attivi.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wi-nome">Nome e cognome</Label>
          <Input
            id="wi-nome"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Mario Rossi"
            required
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wi-telefono">Telefono (facoltativo)</Label>
          <Input
            id="wi-telefono"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="333 1234567"
            autoComplete="off"
            inputMode="tel"
          />
          <p className="text-xs text-slate-500">
            Serve per avvisarlo del turno: senza, il cliente va chiamato a voce.
          </p>
          <label className="mt-1 flex min-h-11 items-center gap-2 text-sm text-slate-700">
            <input
              id="wi-whatsapp"
              type="checkbox"
              className="size-6 accent-[#0065a0]"
              checked={whatsappOptIn}
              onChange={(e) => setWhatsappOptIn(e.target.checked)}
            />
            Il cliente accetta gli avvisi su WhatsApp (altrimenti SMS)
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wi-lavorazione">Lavorazione richiesta / note</Label>
          <textarea
            id="wi-lavorazione"
            value={service}
            onChange={(e) => setService(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Es. rumore anteriore, tagliando, spia motore accesa."
            className="placeholder:text-ink-muted w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-slate-900 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none"
          />
        </div>

        {error !== null ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={chiudi} disabled={saving}>
            Annulla
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Salvataggio…' : 'Metti in coda'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
