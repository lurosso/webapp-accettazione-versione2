// Manifest PWA: aggiunta alla schermata iniziale dell'iPad, l'applicazione si apre a tutto
// schermo, senza la barra di Safari, come un'app dedicata.
//
// Il manifest vale per tutta l'applicazione, non per il solo check-in com'era all'inizio: la
// stessa icona serve all'accettatore sul piazzale e al responsabile che guarda la coda, e
// `start_url: '/'` porta ognuno dove il suo ruolo lo manda. Su iOS le icone del manifest non
// bastano — Safari vuole `apple-touch-icon` in PNG, ed è in `layout.tsx` — ma Android e Chrome
// leggono da qui: PNG a 192 e 512 (generati da `scripts/genera-icone.mjs`) più l'SVG per chi lo
// sa usare. Colori del marchio: il blu scuro della testata fa da fondo alla schermata di avvio,
// così l'icona vi si appoggia senza bordi.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AutoClub Officina',
    short_name: 'AutoClub',
    description:
      'Accettazione officina: coda, check-in fotografico dal tablet, portale cliente e monitoraggio.',
    lang: 'it',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#00466f',
    theme_color: '#00466f',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icona-checkin.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
