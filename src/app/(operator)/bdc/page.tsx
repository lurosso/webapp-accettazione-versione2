// /bdc — l'indirizzo con cui il reparto chiama la propria dashboard.
//
// La pagina vera è /manager (l'area del responsabile, che nel nostro caso è il BDC): qui c'è solo
// il rimando, così chi digita o si salva /bdc arriva dove deve. Un solo cruscotto, due porte.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function BdcPage() {
  redirect('/manager');
}
