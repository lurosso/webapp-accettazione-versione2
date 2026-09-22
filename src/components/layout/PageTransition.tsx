'use client';

// La dissolvenza d'ingresso di una pagina, legata al percorso.
//
// Un `template.tsx` si rimonta quando cambia il SEGMENTO che avvolge, non a ogni cambio di
// pagina: da `/accettazione` a `/accettazione/archivio` il segmento del gruppo è lo stesso, il
// wrapper restava montato e l'animazione CSS — che parte solo quando l'elemento entra nel DOM —
// non ripartiva. Su iPad il cambio di schermata tornava secco. La `key` sul percorso obbliga
// React a smontare e rimontare il contenitore a ogni navigazione: l'animazione riparte sempre,
// anche fra pagine dello stesso gruppo. I parametri di ricerca non contano: cambiare filtro nella
// stessa pagina non deve far lampeggiare tutto.
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function PageTransition({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-entra-pagina" data-testid="transizione-pagina">
      {children}
    </div>
  );
}
