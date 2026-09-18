# Design system — accettazione officina

Una pagina per chi deve scrivere una schermata nuova senza rifare le stesse scelte da capo.
Tutto quello che c'è qui vive in `src/app/globals.css` (blocco `@theme` e utility) e nei
primitivi in `src/components/ui/`. Se una regola e il codice non vanno d'accordo, ha ragione il
codice: aggiorna questa pagina.

Le decisioni e il perché sono in `TASKS.md`, milestone M8-T21 e M8-T22.

---

## La regola che decide tutto: chi sta usando l'applicazione

L'applicazione gira su due attrezzi molto diversi, e la stessa schermata deve andare bene su
entrambi:

- **al banco**, un PC con il mouse: puntatore preciso al pixel, monitor a sessanta centimetri;
- **sul piazzale**, un iPad da 8–10 pollici tenuto in mano, spesso in piedi e con il sole di
  traverso.

A decidere quale delle due è **il puntatore, non la larghezza della finestra**
(`@media (pointer: coarse)`). È la stessa condizione che usa `useIsTouchLayout()` in TypeScript,
quindi CSS e codice non possono dissentire. Un tablet in orizzontale è largo quanto un portatile:
la larghezza non dice niente su come lo si sta toccando.

```css
@custom-variant banco (@media (pointer: fine));   /* mouse   */
@custom-variant tocco (@media (pointer: coarse)); /* dito    */
```

Le usi come qualunque variante Tailwind: `banco:w-60`, `tocco:flex-col`.

### Densità

Le misure non sono numeri fissi: sono variabili che cambiano da sole.

| Utility | Cosa misura | Banco | Dito |
| --- | --- | --- | --- |
| `controllo` | altezza di un comando qualsiasi | 44 px | 52 px |
| `controllo-lg` | azione primaria di una schermata | 48 px | 60 px |
| `riga` | altezza di una riga d'elenco | 56 px | 68 px |
| `casella` | quadrato di una casella di spunta | 20 px | 24 px |
| `testo-nota` | informazione di contorno | 13 px | 15 px |
| `testo-corpo` | testo normale | 14 px | 17 px |
| `testo-dato` | targa, nome, numero che conta | 15 px | 19 px |
| `testo-codice` | il codice della pratica | 17 px | 26 px |

**Non scrivere altezze a mano.** `min-h-11`, `h-14`, `text-sm` su un pulsante: sono già stati
tolti da tutta l'applicazione una volta. Usa `controllo` e le taglie di `Button`, e la schermata
prende la taratura giusta senza saperne niente.

`--spacing-touch` (44 px) resta il pavimento assoluto: vale anche al banco, e `min-w-touch` lo usa
per la larghezza minima dei comandi.

### Quando la struttura cambia, cambiala in CSS

La navigazione è una colonna a sinistra al banco e una barra in alto col dito; la coda è una
tabella al banco e un elenco di schede col dito. In entrambi i casi **la forma la decide il CSS**,
non un ramo di codice: `AppShell` resta un Server Component e la struttura è già giusta al primo
disegno invece di riassestarsi dopo l'idratazione. Dove servono due marcature diverse (coda), ci
sono entrambe nel DOM e una la nasconde `display: none`, che la toglie anche dall'albero di
accessibilità.

---

## Colore

### I due colori del marchio non sono intercambiabili

- **Blu `brand-secondary` (#0065A0)**: struttura, navigazione, azioni di lavoro (prendi in carico,
  cerca, filtra).
- **Verde `brand-primary` (#87BD22)**: solo completamento e avanzamento.

Il verde del marchio con il bianco sopra fa 2,6:1 e non si legge: `Button variant="success"` porta
testo scuro. Per il verde **come testo** c'è `brand-lime-ink` (#3F6B0B, 6,3:1).

### Ruoli, non colori

Scrivere `bg-surface border-line text-ink` dice *cosa è* quell'elemento; scrivere
`bg-white border-slate-200 text-slate-900` dice solo di che colore è.

| Ruolo | Uso |
| --- | --- |
| `surface-app` | fondo della pagina |
| `surface` | fondo di una scheda o di un campo |
| `surface-sunken` | blocchi quieti: intestazioni di tabella, gruppi di schede |
| `line-subtle` / `line` | divisori interni / bordo di scheda e campo |
| `ink` / `ink-soft` / `ink-muted` | testo principale / secondario / di contorno |

`ink-muted` (5,1:1) è **l'ultimo grigio ammesso per il testo**. Sotto di lì si esce dalla norma, e
in officina "fuori norma" vuol dire che l'accettatore non legge la lavorazione senza avvicinare il
tablet.

### Stati e priorità

Ogni stato ha tre tinte: la piena (`--color-status-x`), il fondo tenue (`-soft`) e **l'inchiostro
da scriverci sopra** (`-ink`, tarato per superare 7:1 su quel fondo). Usali sempre in coppia:
`bg-status-no-show-soft text-status-no-show-ink`, mai un rosso Tailwind a occhio.

Stati: `waiting`, `in-progress`, `skipped`, `completed`, `no-show`, `cancelled`, più `info` — che
non è uno stato della pratica ma il tono di un avviso che non chiede niente, e prende il blu del
marchio.

`no-show-solid` è il rosso **pieno** della conferma distruttiva: più scuro della pastiglia perché
lì sopra ci va il bianco (5,6:1).

La famiglia `priority-*` è un'altra cosa ancora: dice **quanto è urgente**, non in che stato è.
`priority-now` (orario superato) e `priority-late` (fuori tolleranza).

### Una priorità per volta

Il fondo di una riga **non dice mai lo stato** — lo dice la pastiglia. Il fondo resta al solo
livello di priorità, uno per volta: l'ambra segna chi ha superato l'orario dentro la tolleranza, e
il blocco dei ritardi si distingue per bordo e titolo senza ritingere ogni riga. Venti righe rosse
una sotto l'altra non sono un avviso: sono uno sfondo.

Stessa logica sui comandi: un'azione distruttiva che compare su **ogni** riga usa
`variant="destructiveQuiet"` e diventa piena solo quando chiede conferma, che è il momento in cui
deve fermare chi sta scorrendo.

---

## Forma

**Raggi** — quattro valori, non otto: 8 px (`sm`), 12 px (`md`, comandi e campi), 16 px (`lg`,
schede), 24 px (`2xl`, superfici grandi e schermate a tutto schermo).

**Ombre** — tinte d'inchiostro (`rgb(20 44 61 / …)`), non nere: su un fondo azzurrino un'ombra
nera vira al grigio sporco. Quattro livelli: `xs` (appoggiato), `sm` (scheda), `md` (menu),
`lg`/`2xl` (finestra sopra il resto).

**Spaziature** — la scala di Tailwind, con il respiro sui contenitori: `p-4` sulle schede fitte,
`p-5`/`p-6` sui pannelli.

**Caratteri** — IBM Plex Sans per il testo, IBM Plex Mono per targhe, codici e orari, che sono
numeri da confrontare in colonna. Sono **ospitati nel progetto**
(`@fontsource-variable/ibm-plex-sans`, `@fontsource/ibm-plex-mono`): l'applicazione non chiama
fonts.googleapis.com né in build né a runtime, che per un'officina on-prem è la scelta giusta a
prescindere.

**Movimento** — `transizione` (160 ms, `--ease-smooth`) per i cambi di stato, `premibile`
(`active:scale(0.98)` + `touch-action: manipulation`) per la risposta al dito, `focus-anello` per
il focus da tastiera (è un `outline`, non un `ring`: non sposta il layout). Tutto sotto
`prefers-reduced-motion` si spegne da sé.

---

## Primitivi

Prima di scrivere una classe, guarda se la cosa esiste già in `src/components/ui/`.

| Componente | Quando |
| --- | --- |
| `Button` | qualunque comando. Taglie `sm` (contorno, in una riga fitta), `md`, `lg` (azione primaria). Varianti `default`, `success`, `outline`, `ghost`, `destructive`, `destructiveQuiet`, `warning`, `onDark` |
| `HoldButton` | comandi che non si disfano da soli — vedi sotto |
| `Panel` + `PanelHeader` | il riquadro bianco con titolo, descrizione e azioni |
| `Notice` | riga d'avviso: esito, errore, cosa da sapere. `tone` fra `info`, `success`, `warning`, `error` |
| `Alert` | il cartello grande, con titolo e azioni: per le cose che fermano il lavoro |
| `Badge` | pastiglia di stato, ruolo, marchio. `dot` aggiunge il pallino, che è il residuo leggibile quando il colore non arriva |
| `ExpandableText` | testo che può essere lunghissimo (le note del veicolo da Infinity): due righe e un comando per aprire, mostrato solo se è davvero troncato |
| `UndoToast` | «Annulla» per cinque secondi dopo un'azione reversibile |
| `Table` | righe già su `riga` e `testo-corpo` |
| `Dialog`, `Input`, `Select`, `Card`, `Skeleton`, `Label` | il resto |

---

## Conferme: quanto costa fermarsi

La regola **non** è «chiedi conferma a tutto». Alla trentesima volta in una mattinata una finestra
di conferma non la legge più nessuno e si preme «Sì» per riflesso: una conferma dappertutto è una
conferma da nessuna parte.

Si paga solo dove l'azione **esce dall'officina o tocca il lavoro di un altro**, e si paga in
proporzione:

1. **Un tocco, con «Annulla» per cinque secondi** — azioni reversibili: prendi in carico, salta.
   `UndoToast` manda l'azione contraria già prevista dalla macchina a stati (`release`, `restore`)
   con la versione **nuova** restituita dal server, così non nasce uno stato intermedio fra client
   e server — che con quattro postazioni sulla stessa fila sarebbe il modo più rapido per far
   litigare due colleghi.
2. **`HoldButton`** — azioni che non si disfano: segnare un cliente assente (genera un lead BDC e
   un evento CRM), chiudere un lead, scollegare un collega, annullare una pratica.
3. **Un `Dialog`** — solo quando la conferma deve **mostrare qualcosa** che il pulsante non può
   dire: il check-in ne ha uno perché riepiloga foto, video e note prima di chiudere la pratica.

`HoldButton` cambia difesa con l'attrezzo in mano, perché cambia il pericolo:

- **col dito** il pericolo è lo sfioramento mentre si scorre l'elenco: serve un gesto che non
  capita per caso, quindi il dito fermo per 900 ms con il pulsante che si riempie da sinistra — si
  vede che sta succedendo qualcosa e ci si può ancora ritirare. Il riempimento è `bg-current` al
  20%: bianco sul pulsante pieno, scuro su quello chiaro, perché un velo bianco fisso sarebbe
  invisibile proprio sui comandi chiari, che sono quelli dove la pressione serve.
- **al banco** il pericolo è il clic distratto: tenere premuto un mouse per un secondo sarebbe solo
  un'attesa senza senso, quindi chiede un secondo clic e nel frattempo dice cosa sta per fare.
- **da tastiera** (`Invio`, `Spazio`: click senza eventi di puntatore) sempre la conferma in due
  passi. **Nessuna azione è raggiungibile solo con un gesto.**

Un tocco troppo breve non fa niente e mostra «Tieni premuto» per due secondi, invece di lasciare
l'accettatore a chiedersi se ha toccato.

---

## Prima di aprire la PR

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- Guardala girare **alle due densità**, non solo a una. In Chrome DevTools la modalità dispositivo
  emula `pointer: coarse`; con Playwright si imposta via CDP
  (`Emulation.setEmulatedMedia`, feature `pointer`).
- Nessun comando sotto i 44 px, nessun testo sotto `ink-muted`, nessun colore grezzo di Tailwind
  (`amber-*`, `red-*`, `emerald-*`, `sky-*`): se ti serve una tinta che non c'è, il posto dove
  aggiungerla è `@theme`, con il contrasto calcolato e il motivo scritto accanto.
