// Il sistema di stile è arrivato a diciassette file su novantuno, e non se n'era accorto nessuno.
//
// È la stessa storia del «lei» nel portale: una regola che dipende dalla disciplina rientra dalla
// finestra al primo file scritto di fretta. Solo che qui non è rientrata una frase, è rimasta
// fuori metà applicazione — e la si vede, perché è esattamente ciò che si nota sull'iPad. Su
// `AppointmentRow.tsx`, la riga della coda, i COLORI sono quelli nuovi e le MISURE quelle vecchie:
// nove `text-xs` accanto a otto `ink-muted`. Al tocco i colori cambiano e il testo resta a 13 px,
// quindi la schermata sembra quella di prima pur essendo stata rifatta.
//
// Due regole, che sono le due metà della stessa decisione:
//
// 1. I COLORI si nominano per RUOLO (`ink-soft`, `surface`, `line`, `status-*`), non per posto
//    nella scala (`slate-500`, `amber-100`). Un ruolo si ritara in un punto solo; una scala va
//    inseguita in cinquanta file, che è la ragione per cui i contrasti calcolati a mano valgono
//    finché qualcuno non scrive `text-slate-400` perché «si vedeva grigio».
//
// 2. Il TESTO si misura con la scala della densità (`testo-nota`, `testo-corpo`, `testo-dato`,
//    `testo-codice`), non con misure fisse. Le misure fisse non sanno che esiste il puntatore
//    grosso: `text-sm` è 14 px al banco e 14 px sul piazzale, con il tablet inclinato e il sole
//    di traverso. È la differenza fra aver applicato il sistema e averlo applicato ai colori.
//
// PERCHÉ UN CRICCHETTO E NON UN DIVIETO. Vietare e basta vorrebbe dire un gate rosso su
// cinquantotto file nello stesso momento, e un elenco di cinquantotto voci non si legge: si
// disattiva. Qui il debito di oggi è scritto qui sotto per nome, il test è VERDE, e le due liste
// possono solo accorciarsi:
//
//   · un file NON in lista che introduce una violazione fa fallire subito — niente debito nuovo;
//   · un file IN lista che è stato ripulito fa fallire finché non lo si toglie dalla lista — così
//     il progresso resta scritto e nessuno ci ricasca sopra.
//
// Quando tutte e due arrivano a zero si può togliere `--color-slate-*` da `@theme`: da quel
// momento la tavolozza grezza non compila più, e questa metà del test diventa una formalità.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Un colore preso dalla scala di Tailwind invece che dal ruolo. `50` e le centinaia: `bg-white` e
 * `text-black` non sono in scala e restano leciti (li usa il marchio, e non hanno un «più chiaro»).
 */
const TAVOLOZZA_GREZZA =
  /\b(?:bg|text|border|divide|ring|from|via|to|outline|decoration|shadow|accent|caret|fill|stroke|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b/;

/**
 * Le tre misure che la scala della densità sostituisce, più i pixel scritti a mano. I titoli
 * (`text-2xl`, `text-3xl`) non sono qui: un titolo si legge da lontano già di suo, e i monitor di
 * campata sono misurati in `vw` apposta, perché lì la distanza di lettura è fissa e non c'è un dito.
 */
const MISURA_FISSA = /\btext-(?:xs|sm|base)\b|\btext-\[\d+px\]/;

/** I commenti di questo progetto sono discorsivi e citano le classi: parlano DI loro, non le usano. */
function senzaCommenti(sorgente: string): string {
  return sorgente.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function fileDi(cartella: string): string[] {
  const trovati: string[] = [];
  for (const voce of readdirSync(cartella)) {
    const percorso = join(cartella, voce);
    if (statSync(percorso).isDirectory()) {
      trovati.push(...fileDi(percorso));
    } else if (/\.tsx?$/.test(voce)) {
      trovati.push(percorso);
    }
  }
  return trovati;
}

function violano(regola: RegExp): string[] {
  return fileDi('src')
    .filter((percorso) => regola.test(senzaCommenti(readFileSync(percorso, 'utf8'))))
    .sort();
}

/** Debito di partenza: 2026-09-18. Si accorcia, non si allunga. */
const DEBITO_TAVOLOZZA = [
  'src/app/(auth)/cambia-password/page.tsx',
  'src/app/(checkin)/layout.tsx',
  'src/app/(display)/error.tsx',
  'src/app/(operator)/accettazione/page.tsx',
  'src/app/(operator)/admin/page.tsx',
  'src/app/(operator)/admin/spoki-test/page.tsx',
  'src/app/(operator)/error.tsx',
  'src/app/(operator)/manager/page.tsx',
  'src/app/(operator)/sistema/page.tsx',
  'src/app/(public)/cliente/page.tsx',
  'src/app/(public)/error.tsx',
  'src/app/(public)/layout.tsx',
  'src/app/error.tsx',
  'src/components/shared/AccessDenied.tsx',
  'src/components/shared/OperatorChip.tsx',
  'src/components/shared/PlaceholderPage.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/button.tsx',
  'src/components/ui/label.tsx',
  'src/components/ui/skeleton.tsx',
  'src/modules/admin/CloseDayPanel.tsx',
  'src/modules/admin/DailyReportPanel.tsx',
  'src/modules/admin/SpokiPanel.tsx',
  'src/modules/bay-displays/BayDisplayBoard.tsx',
  'src/modules/bay-displays/WaitingBoardScreen.tsx',
  'src/modules/crm/BdcDashboard.tsx',
  'src/modules/crm/CrmOutboxTable.tsx',
  'src/modules/customer-portal/ArrivalButton.tsx',
  'src/modules/customer-portal/ConcludedCard.tsx',
  'src/modules/customer-portal/LateNoticeButton.tsx',
  'src/modules/customer-portal/PlateSearchForm.tsx',
  'src/modules/customer-portal/PortalStatusCard.tsx',
  'src/modules/customer-portal/ProgressSteps.tsx',
  'src/modules/customer-portal/PublicStatusView.tsx',
  'src/modules/customer-portal/ServiceUnavailableCard.tsx',
  'src/modules/inspection-media/CheckInQueue.tsx',
  'src/modules/inspection-media/CheckInScreen.tsx',
  'src/modules/inspection-media/InspectionArchive.tsx',
  'src/modules/inspection-media/MediaGallery.tsx',
  'src/modules/inspection-media/PhotoCapture.tsx',
  'src/modules/reception/AppointmentDetailPanel.tsx',
  'src/modules/reception/AppointmentRow.tsx',
  'src/modules/reception/ChangePasswordForm.tsx',
  'src/modules/reception/NewWalkInDialog.tsx',
  'src/modules/reception/NotificationBadge.tsx',
  'src/modules/reception/QueueDashboard.tsx',
  'src/modules/reception/ReturnsTable.tsx',
  'src/modules/reception/SyncBanner.tsx',
] as const;

/** Debito di partenza: 2026-09-18. Si accorcia, non si allunga. */
const DEBITO_MISURE = [
  'src/app/(auth)/cambia-password/page.tsx',
  'src/app/(checkin)/error.tsx',
  'src/app/(operator)/accettazione/page.tsx',
  'src/app/(operator)/admin/page.tsx',
  'src/app/(operator)/admin/spoki-test/page.tsx',
  'src/app/(operator)/error.tsx',
  'src/app/(operator)/manager/page.tsx',
  'src/app/(operator)/sistema/page.tsx',
  'src/app/(public)/cliente/page.tsx',
  'src/app/(public)/error.tsx',
  'src/app/(public)/layout.tsx',
  'src/app/error.tsx',
  'src/components/layout/Header.tsx',
  'src/components/shared/AccessDenied.tsx',
  'src/components/shared/EmptyState.tsx',
  'src/components/shared/OperatorChip.tsx',
  'src/components/shared/PlaceholderPage.tsx',
  'src/components/ui/alert.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/card.tsx',
  'src/components/ui/dialog.tsx',
  'src/components/ui/expandable-text.tsx',
  'src/components/ui/label.tsx',
  'src/components/ui/panel.tsx',
  'src/components/ui/table.tsx',
  'src/modules/admin/AdminDashboard.tsx',
  'src/modules/admin/CloseDayPanel.tsx',
  'src/modules/admin/DailyReportPanel.tsx',
  'src/modules/admin/LiveQueuePanel.tsx',
  'src/modules/admin/MonitoringPanel.tsx',
  'src/modules/admin/OperatorsPanel.tsx',
  'src/modules/admin/SpokiPanel.tsx',
  'src/modules/crm/BdcDashboard.tsx',
  'src/modules/crm/CrmOutboxTable.tsx',
  'src/modules/customer-portal/ArrivalButton.tsx',
  'src/modules/customer-portal/ConcludedCard.tsx',
  'src/modules/customer-portal/LateNoticeButton.tsx',
  'src/modules/customer-portal/PlateSearchForm.tsx',
  'src/modules/customer-portal/PortalStatusCard.tsx',
  'src/modules/customer-portal/ProgressSteps.tsx',
  'src/modules/customer-portal/PublicStatusView.tsx',
  'src/modules/inspection-media/CheckInQueue.tsx',
  'src/modules/inspection-media/CheckInScreen.tsx',
  'src/modules/inspection-media/InspectionArchive.tsx',
  'src/modules/inspection-media/MediaGallery.tsx',
  'src/modules/inspection-media/PhotoCapture.tsx',
  'src/modules/reception/ActionButtons.tsx',
  'src/modules/reception/AppointmentCard.tsx',
  'src/modules/reception/AppointmentDetailPanel.tsx',
  'src/modules/reception/AppointmentRow.tsx',
  'src/modules/reception/ChangePasswordForm.tsx',
  'src/modules/reception/NewWalkInDialog.tsx',
  'src/modules/reception/NotificationBadge.tsx',
  'src/modules/reception/QueueDashboard.tsx',
  'src/modules/reception/QueueTable.tsx',
  'src/modules/reception/ReturnsTable.tsx',
  'src/modules/reception/StatusBadge.tsx',
  'src/modules/reception/SyncBanner.tsx',
] as const;

function cricchetto(nome: string, regola: RegExp, debito: readonly string[], rimedio: string): void {
  describe(nome, () => {
    const attuali = violano(regola);

    it('nessun file nuovo entra nel debito', () => {
      const nuovi = attuali.filter((p) => !debito.includes(p));
      expect(nuovi, `da sistemare prima di consegnare — ${rimedio}:\n${nuovi.join('\n')}`).toEqual(
        [],
      );
    });

    it('i file ripuliti escono dalla lista, così non ci si ricasca', () => {
      const stantii = debito.filter((p) => !attuali.includes(p));
      expect(
        stantii,
        `ripuliti: toglierli dalla lista in questo file, il debito è sceso a ${attuali.length}:\n${stantii.join('\n')}`,
      ).toEqual([]);
    });
  });
}

cricchetto(
  'colori: per ruolo, non per posto nella scala',
  TAVOLOZZA_GREZZA,
  DEBITO_TAVOLOZZA,
  'usare i ruoli (ink, ink-soft, ink-muted, surface, surface-sunken, line, status-*, priority-*)',
);

cricchetto(
  'testo: misure che crescono al tocco',
  MISURA_FISSA,
  DEBITO_MISURE,
  'usare la scala della densità (testo-nota, testo-corpo, testo-dato, testo-codice)',
);
