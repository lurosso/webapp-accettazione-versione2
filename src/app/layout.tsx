// Layout radice dell'App Router: lingua italiana, caratteri, stili globali, provider client.
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
/*
 * Caratteri serviti dal nostro dominio, non da Google Fonts.
 *
 * I file arrivano da un pacchetto npm (Fontsource) e finiscono nel bundle: la build non chiama
 * nessun server esterno e il browser nemmeno. È la stessa regola del resto del sistema —
 * l'officina non deve mai bloccarsi — applicata al testo: una postazione dietro il firewall
 * aziendale, o una build fatta su una macchina senza uscita su Internet, non devono ritrovarsi
 * con i caratteri di ripiego e le colonne disallineate. `next/font/google` avrebbe scaricato i
 * file in fase di build, e sarebbe bastata una build offline per rompere tutto.
 *
 * Sans variabile (un solo file per tutti i pesi da 100 a 700), Mono nei tre pesi che usiamo
 * davvero per targhe, codici pratica e orari.
 */
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'Gestione Accettazione e Flussi Officina',
    template: '%s · Accettazione Officina',
  },
  description: "Web app operatore, portale cliente e monitor di accettazione per l'officina.",
  // Aggiunta alla schermata iniziale del tablet, l'app si apre senza la cornice del browser.
  manifest: '/manifest.webmanifest',
  // iOS non legge le icone del manifest: per la schermata Home vuole `apple-touch-icon` in PNG,
  // altrimenti ci mette uno screenshot della pagina. `black-translucent` fa scorrere la pagina
  // sotto la barra di stato — il blu della testata la riempie — e la testata rispetta il ritaglio
  // con `safe-area-inset-top`.
  appleWebApp: { capable: true, title: 'AutoClub', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#00466f',
  // Consente ai comandi fissi del check-in di rispettare la tacca e la barra dei gesti del tablet.
  viewportFit: 'cover',
};

/*
 * La lente sulla densità, prima che la pagina si disegni.
 *
 * `?densita=tocco` (o `banco`) forza la taratura dell'altro dispositivo in QUALUNQUE browser, e
 * resta per la scheda finché non si scrive `?densita=auto`. Serve a guardare: chi apre il branch su
 * un portatile vede il disegno da banco — giustamente, ha il mouse — e senza un modo di chiedere
 * l'altro conclude che il lavoro non c'è.
 *
 * Gira qui, in testa al corpo, e non in un effetto: un attributo messo dopo l'idratazione farebbe
 * lampeggiare la pagina nella taratura sbagliata, che è proprio quello che questo impianto evita.
 * Senza il parametro non fa niente e comanda il puntatore, come sempre.
 */
const LENTE_DENSITA = `(function(){try{
var p=new URLSearchParams(location.search).get('densita');
if(p==='auto'){sessionStorage.removeItem('densita')}
else if(p==='tocco'||p==='banco'){sessionStorage.setItem('densita',p)}
var d=sessionStorage.getItem('densita');
if(d==='tocco'||d==='banco'){document.documentElement.dataset.densita=d}
else{delete document.documentElement.dataset.densita}
}catch(e){}})()`;

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    /*
     * `suppressHydrationWarning`: lo script della lente mette `data-densita` sull'html PRIMA
     * dell'idratazione, e il server quell'attributo non l'ha scritto. È la differenza che React
     * segnalerebbe — giustamente, se fosse un caso qualunque; qui è voluta, ed è l'unico modo di
     * non far lampeggiare la pagina nella taratura sbagliata. Vale solo per gli attributi di
     * questo elemento, non per l'albero sotto.
     */
    <html lang="it" suppressHydrationWarning>
      <body className="bg-surface-app text-ink min-h-screen font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: LENTE_DENSITA }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
