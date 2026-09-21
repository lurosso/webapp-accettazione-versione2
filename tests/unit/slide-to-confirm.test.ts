// La regola del rilascio del cursore: è quello che decide se un cliente esce dall'officina —
// «segna assente» genera un lead per il BDC e un evento verso il CRM, «completa check-in» manda il
// fascicolo e chiude la pratica. Finora era l'unico pezzo della variante B provato solo a mano.
//
// Non serve un browser per provarla: la decisione è una funzione pura (`esitoRilascio`), il
// componente si limita ad applicarla. È lo stesso taglio del resto del progetto — la regola sta
// dove si può leggere e provare, il disegno le sta intorno.
import { describe, expect, it } from 'vitest';
import {
  esitoRilascio,
  PASSO,
  RITORNO_MS,
  SOGLIA,
  trasformazioni,
  valoreDaTrascinamento,
} from '@/components/ui/slide-to-confirm';

describe('rilascio del cursore di conferma', () => {
  it('in fondo conferma, da qualunque parte arrivi il gesto', () => {
    for (const come of ['dito', 'tastiera', 'uscita'] as const) {
      expect(esitoRilascio(100, come)).toBe('conferma');
      expect(esitoRilascio(SOGLIA, come)).toBe('conferma');
    }
  });

  it('un pelo sotto la soglia non conferma: gli ultimi pixel non bastano', () => {
    expect(esitoRilascio(SOGLIA - 1, 'dito')).not.toBe('conferma');
    expect(esitoRilascio(SOGLIA - 1, 'tastiera')).not.toBe('conferma');
  });

  it('il dito alzato a metà strada è un ripensamento: il cursore torna a zero', () => {
    for (const valore of [0, 20, 50, 80, SOGLIA - 1]) {
      expect(esitoRilascio(valore, 'dito')).toBe('azzera');
    }
  });

  it('una freccia sola lascia il cursore dov’è, o il gesto sarebbe irraggiungibile', () => {
    // Con la tastiera il gesto si compone un colpo alla volta: azzerare a ogni tasto vorrebbe dire
    // che nessuno, da tastiera, arriva mai in fondo.
    for (const valore of [PASSO, PASSO * 2, PASSO * 4]) {
      expect(esitoRilascio(valore, 'tastiera')).toBe('resta');
    }
  });

  it('uscire dal campo azzera come il dito: un gesto lasciato a metà non resta appeso', () => {
    expect(esitoRilascio(60, 'uscita')).toBe('azzera');
  });

  it('cinque colpi di freccia arrivano in fondo, e il passo non lascia resti', () => {
    expect(100 % PASSO).toBe(0);
    expect(100 / PASSO).toBe(5);
    // Il penultimo colpo deve restare sotto la soglia, altrimenti si confermerebbe in quattro.
    expect(100 - PASSO).toBeLessThan(SOGLIA);
  });
});

describe('il gesto è il trascinamento, non il tocco', () => {
  it('un tocco secco, in qualunque punto della pista, vale zero', () => {
    // Spostamento nullo: il dito ha toccato e si è alzato lì. Anche in fondo alla pista.
    expect(valoreDaTrascinamento(0, 300)).toBe(0);
  });

  it('il cursore avanza di quanto il dito si sposta, in proporzione alla corsa utile', () => {
    expect(valoreDaTrascinamento(150, 300)).toBe(50);
    expect(valoreDaTrascinamento(288, 300)).toBe(SOGLIA);
  });

  it('oltre la corsa vale cento, indietro vale zero', () => {
    expect(valoreDaTrascinamento(450, 300)).toBe(100);
    expect(valoreDaTrascinamento(-40, 300)).toBe(0);
  });

  it('una pista collassata non produce mai un valore: nessuna conferma da un cursore invisibile', () => {
    expect(valoreDaTrascinamento(200, 0)).toBe(0);
    expect(valoreDaTrascinamento(200, -12)).toBe(0);
    expect(valoreDaTrascinamento(Number.NaN, 300)).toBe(0);
  });

  it('un saltello intermedio rilasciato non conferma: serve arrivare in fondo', () => {
    // 80% di corsa e poi il dito si alza: sotto soglia, e col dito si torna a zero.
    expect(esitoRilascio(valoreDaTrascinamento(240, 300), 'dito')).toBe('azzera');
    expect(esitoRilascio(valoreDaTrascinamento(300, 300), 'dito')).toBe('conferma');
  });
});

describe('solo transform: niente width, niente left, niente layout', () => {
  // Pista da 256 px, pollice da 40: la corsa utile è 256 - 40 - 8 = 208.
  const PISTA = 256;
  const CORSA = 208;

  it('a riposo il pollice è a zero e il riempimento è tutto fuori vista, a sinistra', () => {
    expect(trasformazioni(0, CORSA, PISTA)).toEqual({
      pollice: 'translate3d(0px, 0, 0)',
      riempimento: 'translate3d(-256px, 0, 0)',
    });
  });

  it('il riempimento avanza di quanto avanza il pollice: il suo bordo destro gli resta dietro', () => {
    const t = trasformazioni(104, CORSA, PISTA);
    expect(t.pollice).toBe('translate3d(104px, 0, 0)');
    expect(t.riempimento).toBe('translate3d(-152px, 0, 0)');
  });

  it('in fondo il pollice è a fine corsa e il riempimento arriva dove il pollice comincia', () => {
    expect(trasformazioni(CORSA, CORSA, PISTA)).toEqual({
      pollice: 'translate3d(208px, 0, 0)',
      riempimento: 'translate3d(-48px, 0, 0)',
    });
  });

  it('oltre la corsa o indietro si ferma ai bordi: il pollice non esce dalla pista', () => {
    expect(trasformazioni(999, CORSA, PISTA).pollice).toBe('translate3d(208px, 0, 0)');
    expect(trasformazioni(-30, CORSA, PISTA).pollice).toBe('translate3d(0px, 0, 0)');
  });

  it('ogni stringa è un translate3d e nient altro: è quello che il compositore muove senza layout', () => {
    for (const px of [0, 50, CORSA]) {
      const t = trasformazioni(px, CORSA, PISTA);
      expect(t.pollice).toMatch(/^translate3d\(-?\d+px, 0, 0\)$/);
      expect(t.riempimento).toMatch(/^translate3d\(-?\d+px, 0, 0\)$/);
    }
  });

  it('il ritorno a riposo è breve: si vede, non si aspetta', () => {
    expect(RITORNO_MS).toBeGreaterThanOrEqual(150);
    expect(RITORNO_MS).toBeLessThanOrEqual(300);
  });
});
