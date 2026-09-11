// Hook di avvio di Next.js (`register()` viene eseguito una volta all'avvio del server).
// 1) costruisce subito il container: una configurazione rifiutata (`ConfigurationError`) o un
//    adapter reale non disponibile (`NotImplementedError`) emergono all'avvio, non alla prima richiesta;
// 2) avvia lo scheduler della sync giornaliera (06:00 con catch-up al riavvio) e il
//    temporizzatore dei rinvii verso il CRM (spegnibile con CRM_RETRY_ENABLED=false, quando a
//    riprovare è un cron esterno sull'endpoint /api/v1/system/cron/crm-retry).
// Un solo scheduler per processo, anche con l'HMR di sviluppo (flag su globalThis).
export async function register(): Promise<void> {
  // Solo nel runtime Node: i mock e lo store in memoria non hanno senso nell'edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { getContainer, SCHEDULER_STARTED_KEY } = await import('@/config/container');
  const container = getContainer();

  const g = globalThis as unknown as Record<string, unknown>;
  if (g[SCHEDULER_STARTED_KEY] === true) {
    return;
  }
  g[SCHEDULER_STARTED_KEY] = true;
  container.syncScheduler.start();
  if (container.env.crmRetryEnabled) {
    container.crmRetryScheduler.start();
  }
}
