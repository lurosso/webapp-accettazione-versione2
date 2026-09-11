// Messaggio mostrato quando la sessione è valida ma il ruolo non basta per l'area richiesta.
// Si preferisce dirlo apertamente invece di reindirizzare in silenzio: chi arriva qui deve capire
// perché non vede la pagina e dove può andare.
import Link from 'next/link';
import type { OperatorRole } from '@/domain/entities/operator';
import { ROLE_LABELS } from '@/components/shared/OperatorChip';
import { homePathForRole } from '@/lib/navigation';

export interface AccessDeniedProps {
  /** Descrizione dell'area, es. "area di amministrazione". */
  readonly area: string;
  readonly role: OperatorRole;
}

export function AccessDenied({ area, role }: AccessDeniedProps) {
  return (
    <div className="bg-status-in-progress-soft mx-auto max-w-2xl rounded-xl border border-amber-300 p-6 shadow-sm">
      <h1 className="text-xl font-bold text-amber-900">Accesso non consentito</h1>
      <p className="mt-2 text-sm text-amber-900">
        Il tuo ruolo ({ROLE_LABELS[role]}) non può accedere all&apos;{area}. Se ti serve, chiedi a
        un amministratore di modificare i tuoi permessi.
      </p>
      <Link
        href={homePathForRole(role)}
        className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
      >
        Torna alla tua area
      </Link>
    </div>
  );
}
