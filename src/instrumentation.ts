// Hook di avvio di Next.js (`register()` viene eseguito una volta all'avvio del server).
// Anticipato da M1: costruisce il container subito, così una configurazione rifiutata
// (`ConfigurationError`) o un adapter reale non disponibile (`NotImplementedError`) fanno fallire
// l'avvio del processo (fail-fast reale) invece di emergere alla prima richiesta.
// In M1 qui si aggiungeranno lo scheduler della sync (06:00 con catch-up) e lo svuotamento outbox.
export async function register(): Promise<void> {
  // Solo nel runtime Node: i mock e lo store in memoria non hanno senso nell'edge runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getContainer } = await import('@/config/container');
    getContainer();
  }
}
