// Manifest PWA: aggiunto alla schermata iniziale del tablet, il check-in si apre senza la barra
// degli indirizzi del browser, come un'app dedicata. `start_url` punta al check-in perché è la
// sola vista che sul piazzale si usa a tutto schermo; il login, se serve, arriva dal redirect.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Accettazione Officina · Check-in veicolo',
    short_name: 'Check-in',
    description: 'Giro fotografico e presa in carico dei veicoli dal tablet sul piazzale.',
    lang: 'it',
    start_url: '/check-in',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f2f2f2',
    theme_color: '#00466f',
    icons: [{ src: '/icona-checkin.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
