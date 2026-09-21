// Media nei test di retention e archivio. Da quando foto e video si acquisiscono solo con il
// check-in aperto (pratica IN_PROGRESS), i test che ragionano su pratiche già concluse — cento
// giorni dopo, con la commessa chiusa — hanno bisogno di un modo per metterci dentro una foto
// "come se" fosse stata scattata al momento giusto: si apre la pratica, si carica, si richiude
// nello stato di partenza. Lo stato lì è un dato, non un flusso da riprodurre.
import type {
  AddMediaInput,
  InspectionService,
  StoredPhoto,
} from '@/application/media/InspectionService';
import type { DomainError } from '@/domain/errors';
import type { Result } from '@/domain/result';
import type { IAppointmentRepository } from '@/repositories/interfaces';

export async function addMediaAsInProgress(
  appointments: IAppointmentRepository,
  inspection: InspectionService,
  input: AddMediaInput,
): Promise<Result<StoredPhoto, DomainError>> {
  const prima = await appointments.findById(input.appointmentId);
  if (prima === null || prima.status === 'IN_PROGRESS') {
    return inspection.addMedia(input);
  }
  const aperta = await appointments.update({ ...prima, status: 'IN_PROGRESS' }, prima.version);
  if (!aperta.ok) {
    throw new Error(aperta.error.message);
  }
  const esito = await inspection.addMedia(input);
  const dopo = await appointments.findById(input.appointmentId);
  if (dopo !== null) {
    const richiusa = await appointments.update({ ...dopo, status: prima.status }, dopo.version);
    if (!richiusa.ok) {
      throw new Error(richiusa.error.message);
    }
  }
  return esito;
}
