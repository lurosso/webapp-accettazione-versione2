import { describe, expect, it } from 'vitest';
import { buildTemplateVars, NOTIFICATION_TEMPLATES } from '@/application/notifications/templates';
import { buildSeedData } from '@/config/seed';
import { makeAppointment } from '../helpers/fixtures';

describe('Template dei promemoria: il saluto', () => {
  it('senza nome (azienda dei dati reali) saluta con la ragione sociale, mai "Buongiorno ,"', () => {
    const brand = buildSeedData().brands[0]!;
    const base = makeAppointment();
    const azienda = makeAppointment({
      customer: { ...base.customer, firstName: '', lastName: 'PRISCIANDARO SRL' },
    });
    const testo = NOTIFICATION_TEMPLATES.REMINDER_SAME_DAY.render(
      buildTemplateVars(azienda, brand),
    );
    expect(testo.startsWith('Buongiorno PRISCIANDARO SRL, ')).toBe(true);
    expect(testo).not.toContain('Buongiorno ,');

    const persona = makeAppointment({
      customer: { ...base.customer, firstName: 'Mario', lastName: 'Rossi' },
    });
    const vars = buildTemplateVars(persona, brand);
    expect(NOTIFICATION_TEMPLATES.REMINDER_SAME_DAY.render(vars)).toContain('Buongiorno Mario,');
    expect(vars.lastName).toBe('Rossi');
  });
});
