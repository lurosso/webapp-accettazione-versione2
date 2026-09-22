// Il contenuto dell'area operatore entra con una dissolvenza breve a ogni cambio di pagina.
//
// Un `template` — a differenza del layout — si rimonta a ogni navigazione, quindi l'animazione
// riparte ogni volta che si passa da una schermata all'altra (coda → archivio, coda → check-in e
// ritorno). 180 ms: abbastanza per non far "scattare" il cambio di contesto, troppo poco per farsi
// notare come attesa. Chi ha chiesto meno movimento al sistema non la vede (`prefers-reduced-motion`
// in `globals.css`).
import type { ReactNode } from 'react';

export default function OperatorTemplate({ children }: { readonly children: ReactNode }) {
  return <div className="animate-entra-pagina">{children}</div>;
}
