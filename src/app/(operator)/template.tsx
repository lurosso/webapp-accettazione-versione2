// Il contenuto dell'area operatore entra con una dissolvenza breve a ogni cambio di pagina.
//
// Il lavoro lo fa `PageTransition`, che lega il contenitore animato al percorso corrente
// (`key={pathname}`): un template da solo si rimonta quando cambia il segmento, e fra pagine dello
// stesso gruppo (coda → archivio) l'animazione non ripartiva. 180 ms: abbastanza per non far
// "scattare" il cambio di contesto, troppo poco per farsi notare come attesa.
import type { ReactNode } from 'react';
import { PageTransition } from '@/components/layout/PageTransition';

export default function OperatorTemplate({ children }: { readonly children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
