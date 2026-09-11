// Layout dei monitor di campata: nessuna intestazione, nessun margine, nessuno scorrimento.
// Lo schermo appartiene interamente al contenuto (kiosk a tutto schermo).
import type { ReactNode } from 'react';

export default function DisplayLayout({ children }: { readonly children: ReactNode }) {
  return <div className="h-screen w-screen overflow-hidden">{children}</div>;
}
