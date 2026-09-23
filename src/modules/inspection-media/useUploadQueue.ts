'use client';

// I caricamenti in attesa di una pratica, per la schermata di check-in: cosa sta partendo, a che
// punto è, cosa aspetta la rete. La coda è della pagina (`getUploadQueue`), qui la si guarda.
// Sul server (rendering iniziale) non c'è nessuna coda: l'elenco è vuoto finché la pagina non
// si idrata nel browser.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { InspectionPhoto } from '@/lib/api-client/client';
import type { EnqueueInput, PendingUpload, UploadQueue } from './upload-queue';
import { getUploadQueue } from './upload-store';

const VUOTO: readonly PendingUpload[] = [];
const nessunaDisiscrizione = (): void => undefined;

function codaDelBrowser(): UploadQueue | null {
  return typeof window === 'undefined' ? null : getUploadQueue();
}

export interface UploadQueueView {
  /** File della pratica non ancora salvati sul server, dai più vecchi. */
  readonly pending: readonly PendingUpload[];
  /** true se i file in attesa restano sul tablet anche chiudendo la pagina. */
  readonly persistent: boolean;
  readonly enqueue: (input: Omit<EnqueueInput, 'appointmentId'>) => Promise<string>;
  readonly retryNow: (id?: string) => void;
  readonly discard: (id: string) => Promise<void>;
}

/** Tutti i file in attesa sul tablet, di qualunque pratica. */
export function useAllPendingUploads(): readonly PendingUpload[] {
  const coda = codaDelBrowser();
  const subscribe = useCallback(
    (listener: () => void) => (coda === null ? nessunaDisiscrizione : coda.subscribe(listener)),
    [coda],
  );
  return useSyncExternalStore(
    subscribe,
    () => (coda === null ? VUOTO : coda.snapshot()),
    () => VUOTO,
  );
}

export function useUploadQueue(
  appointmentId: string,
  onUploaded?: (media: InspectionPhoto) => void,
): UploadQueueView {
  const coda = codaDelBrowser();
  const tutti = useAllPendingUploads();
  const pending = useMemo(
    () => tutti.filter((u) => u.appointmentId === appointmentId),
    [tutti, appointmentId],
  );

  useEffect(() => {
    if (coda === null || onUploaded === undefined) {
      return undefined;
    }
    return coda.onUploaded((id, media) => {
      if (id === appointmentId) {
        onUploaded(media);
      }
    });
  }, [coda, appointmentId, onUploaded]);

  return {
    pending,
    persistent: coda?.persistent ?? false,
    enqueue: (input) =>
      coda === null
        ? Promise.reject(new Error('coda non disponibile'))
        : coda.enqueue({ ...input, appointmentId }),
    retryNow: (id) => coda?.retryNow(id),
    discard: (id) => coda?.discard(id) ?? Promise.resolve(),
  };
}

/** Riprende i caricamenti rimasti sul tablet appena si apre una pagina del check-in. */
export function UploadResumer(): null {
  useEffect(() => {
    void getUploadQueue().init();
  }, []);
  return null;
}
