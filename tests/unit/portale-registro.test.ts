// Il portale cliente dà del lei. È una decisione del committente sul tono aziendale, non una
// preferenza di stile, e senza una guardia rientra dalla finestra alla prima frase scritta di
// fretta — è già successo: due stringhe erano rimaste al tu a una riga di distanza da una riga
// appena riscritta.
//
// La prima versione di questo test guardava solo gli export di `status-messages.ts` e prometteva
// «ogni messaggio»: lasciava fuori le etichette dei pulsanti, i messaggi di validazione e i
// metadati delle pagine, che sono esattamente dove i due residui si erano nascosti. Questo legge
// i FILE, che è il perimetro vero.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Cartelle che parlano al cliente. Tutto il resto dell'applicazione parla ai colleghi. */
const AREE = ['src/modules/customer-portal', 'src/app/(public)'];

/**
 * Seconda persona singolare: pronomi, possessivi e gli imperativi che compaiono in un'interfaccia.
 * `sei` vuole lo spazio dopo, per non inciampare in un «sei» che conta.
 */
const DEL_TU =
  /\b(ti|tu|tuo|tua|tuoi|tue|attendi|riprova|rivolgiti|controlla|inserisci|digitala|digitale|toccalo|tocchi tu|segui|tienila|vedrai|puoi)\b|\bsei /i;

/** I commenti sono in italiano e discorsivi: parlano DI questa regola, non al cliente. */
function senzaCommenti(sorgente: string): string {
  return sorgente.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function fileDi(cartella: string): string[] {
  const trovati: string[] = [];
  for (const voce of readdirSync(cartella)) {
    const percorso = join(cartella, voce);
    if (statSync(percorso).isDirectory()) {
      trovati.push(...fileDi(percorso));
    } else if (/\.(ts|tsx)$/.test(voce)) {
      trovati.push(percorso);
    }
  }
  return trovati;
}

describe('registro del portale cliente', () => {
  it('nessuna schermata pubblica dà del tu al cliente', () => {
    const colpevoli: string[] = [];
    for (const area of AREE) {
      for (const percorso of fileDi(area)) {
        const righe = senzaCommenti(readFileSync(percorso, 'utf8')).split('\n');
        righe.forEach((riga, i) => {
          const trovato = DEL_TU.exec(riga);
          if (trovato !== null) {
            colpevoli.push(`${percorso}:${i + 1} «${trovato[0].trim()}» → ${riga.trim()}`);
          }
        });
      }
    }
    expect(colpevoli, `frasi al tu:\n${colpevoli.join('\n')}`).toEqual([]);
  });
});
