import { describe, expect, it } from 'vitest';
import { buildTemplateVars, NOTIFICATION_TEMPLATES } from '@/application/notifications/templates';
import { buildSeedData } from '@/config/seed';
import { makeAppointment } from '../helpers/fixtures';

describe('Template dei messaggi: il saluto', () => {
  it('senza nome (azienda dei dati reali) i messaggi che salutano usano la ragione sociale, mai "Buongiorno ,"', () => {
    const brand = buildSeedData().brands[0]!;
    const base = makeAppointment();
    const azienda = makeAppointment({
      customer: { ...base.customer, firstName: '', lastName: 'PRISCIANDARO SRL' },
    });
    const varsAzienda = buildTemplateVars(azienda, brand);
    expect(varsAzienda.firstName).toBe('PRISCIANDARO SRL');
    const benvenuto = NOTIFICATION_TEMPLATES.CHECK_IN_STARTED.render(varsAzienda);
    expect(benvenuto.startsWith('Buongiorno PRISCIANDARO SRL, ')).toBe(true);
    // I promemoria non salutano per nome: nessun testo deve mai contenere "Buongiorno ,".
    for (const kind of [
      'REMINDER_PREVIOUS_DAY',
      'REMINDER_SAME_DAY',
      'CHECK_IN_STARTED',
    ] as const) {
      expect(NOTIFICATION_TEMPLATES[kind].render(varsAzienda)).not.toContain('Buongiorno ,');
    }

    const persona = makeAppointment({
      customer: { ...base.customer, firstName: 'Mario', lastName: 'Rossi' },
    });
    const vars = buildTemplateVars(persona, brand);
    expect(NOTIFICATION_TEMPLATES.CHECK_IN_STARTED.render(vars)).toContain('Buongiorno Mario,');
    expect(vars.lastName).toBe('Rossi');
  });
});
