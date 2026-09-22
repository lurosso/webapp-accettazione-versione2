// Check-in: lo slot obbligatorio del video si blocca dopo il primo caricamento riuscito.
// Rendering statico (react-dom/server): basta per dire cosa c'è e cosa non c'è nel DOM iniziale,
// che è esattamente la differenza fra «pulsante ancora premibile» e «solo anteprima + ×».
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InspectionPhoto } from '@/lib/api-client/client';
import { PhotoCapture } from '@/modules/inspection-media/PhotoCapture';

function render(media: readonly InspectionPhoto[]): string {
  return renderToStaticMarkup(
    createElement(PhotoCapture, {
      appointmentId: 'apt-1',
      media,
      onUploaded: () => undefined,
      onRemove: async () => undefined,
    }),
  );
}

const video: InspectionPhoto = {
  id: 'video-1',
  url: '/api/v1/media/video-1.mp4',
  kind: 'VIDEO',
  mimeType: 'video/mp4',
  capturedAt: '2026-09-21T08:12:00.000Z',
  sizeBytes: 4_000_000,
  category: null,
  archivedAt: null,
};

describe('Check-in: slot del video obbligatorio', () => {
  it('senza video mostra il comando di registrazione, e nessun riquadro video', () => {
    const html = render([]);
    expect(html).toContain('data-testid="registra-video"');
    expect(html).toContain('obbligatorio · tocca per registrare');
    expect(html).not.toContain('data-testid="video-1"');
  });

  it('dopo il primo video il comando sparisce: resta il riquadro del video con il suo ×', () => {
    const html = render([video]);
    expect(html).not.toContain('data-testid="registra-video"');
    expect(html).not.toContain('Registra un altro video');
    expect(html).toContain('data-testid="video-1"');
    expect(html).toContain('aria-label="Elimina il video 1"');
  });

  it('la fotocamera resta la via principale, il rullino quella secondaria: input senza capture e tipi video espliciti', () => {
    const html = render([]);
    // Il pulsante «Galleria» apre un input SENZA capture: iOS propone rullino, fotocamera o file.
    expect(html).toContain('data-testid="dal-rullino"');
    expect(html).toMatch(/<input[^>]*data-testid="input-galleria"[^>]*>/);
    const galleria = /<input[^>]*data-testid="input-galleria"[^>]*>/.exec(html)?.[0] ?? '';
    expect(galleria).not.toContain('capture=');
    expect(galleria).toContain('accept="image/*,video/mp4,video/quicktime,video/*"');
    // Il video del giro: fotocamera diretta, tipi dell'iPad espliciti davanti al jolly.
    const video = /<input[^>]*data-testid="input-video"[^>]*>/.exec(html)?.[0] ?? '';
    expect(video).toContain('capture="environment"');
    expect(video).toContain('accept="video/mp4,video/quicktime,video/*"');
    // Il promemoria sulla qualità nativa: Fotocamera dell'iPad più «Galleria».
    expect(html).toContain('data-testid="nota-qualita-video"');
    expect(html).toContain('Fotocamera');
  });

  it('con il check-in chiuso (senza onRemove) il video resta visibile ma senza ×', () => {
    const html = renderToStaticMarkup(
      createElement(PhotoCapture, {
        appointmentId: 'apt-1',
        media: [video],
        onUploaded: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="video-1"');
    expect(html).not.toContain('aria-label="Elimina il video 1"');
    expect(html).not.toContain('data-testid="registra-video"');
  });
});
