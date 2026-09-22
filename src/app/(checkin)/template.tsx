// Il check-in entra con la stessa dissolvenza breve dell'area operatore, legata al percorso
// (`PageTransition`): passando dalla coda al piazzale e ritorno il cambio di schermata si
// ammorbidisce senza rallentare nessuno.
import type { ReactNode } from 'react';
import { PageTransition } from '@/components/layout/PageTransition';

export default function CheckInTemplate({ children }: { readonly children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
