// La regola del rilascio del cursore: è quello che decide se un cliente esce dall'officina —
// «segna assente» genera un lead per il BDC e un evento verso il CRM, «completa check-in» manda il
// fascicolo e chiude la pratica. Finora era l'unico pezzo della variante B provato solo a mano.
//
// Non serve un browser per provarla: la decisione è una funzione pura (`esitoRilascio`), il
// componente si limita ad applicarla. È lo stesso taglio del resto del progetto — la regola sta
// dove si può leggere e provare, il disegno le sta intorno.
import { describe, expect, it } from 'vitest';
import { esitoRilascio, PASSO, SOGLIA } from '@/components/ui/slide-to-confirm';

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
