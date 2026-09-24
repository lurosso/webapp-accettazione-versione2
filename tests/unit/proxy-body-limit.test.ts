// Il proxy di Next (`src/proxy.ts`) copia il corpo delle richieste fino a
// `experimental.proxyClientMaxBodySize` e oltre lo tronca senza errore. Il caricamento dei media
// del check-in passa dal proxy: la soglia deve stare sopra il tetto dell'intera richiesta di
// caricamento, altrimenti un video grande arriva monco e viene rifiutato come «corpo non valido».
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { MAX_UPLOAD_REQUEST_BYTES } from '@/app/api/v1/appointments/[id]/media/route';
import { MAX_VIDEO_BYTES } from '@/application/media/InspectionService';
import { PROXY_CLIENT_MAX_BODY_BYTES } from '@/config/request-limits';

describe('limite del corpo delle richieste nel proxy', () => {
  it('next.config usa la soglia dichiarata, non i 10 MB di default', () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(PROXY_CLIENT_MAX_BODY_BYTES);
    expect(PROXY_CLIENT_MAX_BODY_BYTES).toBeGreaterThan(10 * 1024 * 1024);
  });

  it('la soglia copre il video più grande ammesso con il contorno multipart', () => {
    expect(MAX_UPLOAD_REQUEST_BYTES).toBeGreaterThan(MAX_VIDEO_BYTES);
    expect(PROXY_CLIENT_MAX_BODY_BYTES).toBeGreaterThanOrEqual(MAX_UPLOAD_REQUEST_BYTES);
  });
});
