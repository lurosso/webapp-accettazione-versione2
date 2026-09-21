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
