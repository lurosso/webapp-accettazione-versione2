'use client';

// Avviso nell'elenco del check-in: foto e video ancora sul tablet, di qualunque pratica. Serve a
// due cose. La prima è la tranquillità: «Salta per ora» con un video che sta partendo non lo
// ferma, e qui si vede che sta ancora viaggiando. La seconda è non dimenticare niente: un file
// rifiutato dal server resta sul tablet finché qualcuno non decide, e se la sua pratica non è più
// in elenco (chiusa da un collega) l'unico posto dove scartarlo è questo.
import { Button } from '@/components/ui/button';
import { getUploadQueue } from './upload-store';
import { useAllPendingUploads } from './useUploadQueue';

export interface PendingUploadsNoticeProps {
  /** Codice della pratica (F012) se è ancora in elenco; null se non c'è più. */
  readonly codeFor: (appointmentId: string) => string | null;
}

export function PendingUploadsNotice({ codeFor }: PendingUploadsNoticeProps) {
  const tutti = useAllPendingUploads();
  if (tutti.length === 0) {
    return null;
  }
  const gruppi = new Map<string, { inViaggio: number; rifiutati: string[] }>();
  for (const u of tutti) {
    const g = gruppi.get(u.appointmentId) ?? { inViaggio: 0, rifiutati: [] };
    if (u.status === 'FAILED') {
      g.rifiutati.push(u.id);
    } else {
      g.inViaggio += 1;
    }
    gruppi.set(u.appointmentId, g);
  }
  const inViaggio = tutti.filter((u) => u.status !== 'FAILED').length;
  const orfaniRifiutati = [...gruppi.entries()]
    .filter(([appointmentId, g]) => g.rifiutati.length > 0 && codeFor(appointmentId) === null)
    .flatMap(([, g]) => g.rifiutati);

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-status-info-soft text-status-info-ink testo-corpo flex flex-col gap-2 rounded-2xl px-5 py-4"
      data-testid="avviso-caricamenti"
    >
      <p className="font-semibold">
        {tutti.length === 1
          ? '1 file in attesa di caricamento'
          : `${tutti.length} file in attesa di caricamento`}
        {' · '}
        {[...gruppi.entries()]
          .map(([appointmentId, g]) => {
            const n = g.inViaggio + g.rifiutati.length;
            return `${codeFor(appointmentId) ?? 'pratica chiusa'} (${n})`;
          })
          .join(', ')}
      </p>
      {inViaggio > 0 ? (
        <p className="testo-nota">
          Partono da soli appena la rete lo consente, anche mentre lavori su un&apos;altra pratica.
        </p>
      ) : null}
      {orfaniRifiutati.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="testo-nota">
            {orfaniRifiutati.length === 1
              ? 'Un file è stato rifiutato e la sua pratica non è più in elenco.'
              : `${orfaniRifiutati.length} file sono stati rifiutati e la loro pratica non è più in elenco.`}
          </span>
          <Button
            variant="outline"
            size="touch"
            onClick={() => {
              for (const id of orfaniRifiutati) {
                void getUploadQueue().discard(id);
              }
            }}
          >
            Scarta dal tablet
          </Button>
        </div>
      ) : null}
    </div>
  );
}
