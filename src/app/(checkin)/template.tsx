// Il check-in entra con la stessa dissolvenza breve dell'area operatore: passando dalla coda al
// piazzale e ritorno il cambio di schermata si ammorbidisce senza rallentare nessuno (180 ms).
import type { ReactNode } from 'react';

export default function CheckInTemplate({ children }: { readonly children: ReactNode }) {
  return <div className="animate-entra-pagina">{children}</div>;
}
