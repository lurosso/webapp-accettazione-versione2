// Dati della pagina di login che cambiano mentre la si guarda: le postazioni, libere o occupate.
// Cartella privata `_server`: non genera rotte. Li usano la pagina (al primo caricamento) e
// `GET /api/v1/auth/login-options` (che il form richiama a intervalli), così i due non possono dire
// cose diverse.
import { buildLoginOptions, type LoginWorkstationOption } from '@/application/auth/login-options';
import { workstationAvailability, type BusyBay } from '@/application/auth/workstation-availability';
import type { Container } from '@/config/container';

/** Le postazioni come le propone il login: libere, oppure occupate con il motivo. */
export async function loadLoginOptions(
  container: Container,
): Promise<readonly LoginWorkstationOption[]> {
  const now = container.clock.nowIso();
  const [desks, workstations, brands, operators, claims, inCarico] = await Promise.all([
    container.repos.referenceData.listDesks(),
    container.repos.referenceData.listWorkstations(),
    container.repos.referenceData.listBrands(),
    container.repos.operators.listActive(),
    container.repos.workstationClaims.listActive(now),
    container.repos.appointments.listByDate(container.clock.today(), {
      statuses: ['IN_PROGRESS'],
    }),
  ]);

  // Si propongono solo le accettazioni libere: né un collega collegato, né un veicolo in carico.
  const busyBays: BusyBay[] = inCarico
    .filter((a) => a.bayId !== null)
    .map((a) => ({
      bayId: a.bayId as string,
      code: a.code,
      operatorId: a.operatorId,
      operatorName:
        a.operatorId === null
          ? null
          : (operators.find((o) => o.id === a.operatorId)?.displayName ?? null),
    }));
  const disponibilita = workstationAvailability({ workstations, claims, busyBays, now });

  // Un solo menu: ogni accettazione porta con sé sportello e marchi; le occupate non si scelgono.
  return buildLoginOptions({
    workstations,
    desks: desks.filter((d) => d.isActive),
    brands,
    availability: disponibilita,
  });
}
