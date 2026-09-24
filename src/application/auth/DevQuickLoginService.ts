// Accesso veloce di SVILUPPO (DEV_QUICK_LOGIN): un pulsante per profilo nella pagina di login, senza
// credenziali, per cambiare ruolo in fretta durante il debug e dopo ogni riavvio (lo store in
// memoria si azzera e con il profilo di seed real l'unico account ha una password provvisoria).
// Usa account dedicati `dev.*`, creati al primo uso con una password casuale mai comunicata a
// nessuno: gli account veri (l'admin del profilo real, gli accettatori creati da /admin) non vengono
// toccati. Il container lo costruisce solo fuori da NODE_ENV=production e la rotta risponde 404
// quando è assente: in produzione questa classe non esiste proprio.
import { randomBytes } from 'node:crypto';
import type { Desk } from '@/domain/entities/desk';
import type { Operator, OperatorRole } from '@/domain/entities/operator';
import type { Workstation } from '@/domain/entities/workstation';
import type { DomainError } from '@/domain/errors';
import { domainError } from '@/domain/errors';
import { asOperatorId } from '@/domain/ids';
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import { hashPassword } from '@/lib/hash-password';
import type {
  IOperatorRepository,
  IReferenceDataRepository,
  IWorkstationClaimRepository,
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { IssuedSession } from './IAuthService';

/** Un pulsante della pagina di login. */
export interface QuickLoginProfile {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly role: OperatorRole;
  /** Sportello dell'accettatore; null per l'amministratore (tutti gli sportelli). */
  readonly deskCode: string | null;
  readonly username: string;
}

/** Chi sa emettere una sessione per un operatore già verificato (LocalAuthService). */
export interface SessionIssuer {
  issueSession(operator: Operator, workstation: Workstation): Promise<IssuedSession>;
}

export interface DevQuickLoginServiceDeps {
  readonly operators: IOperatorRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly claims: IWorkstationClaimRepository;
  readonly auth: SessionIssuer;
  readonly clock: IClock;
  readonly logger: ILogger;
}

/** Prefisso dei nomi utente degli account di sviluppo. */
export const DEV_USERNAME_PREFIX = 'dev.';

export class DevQuickLoginService {
  private readonly logger: ILogger;

  constructor(private readonly deps: DevQuickLoginServiceDeps) {
    this.logger = deps.logger.child('[QuickLogin]');
  }

  /** Amministratore e un accettatore per ogni sportello attivo. */
  async profiles(): Promise<readonly QuickLoginProfile[]> {
    const desks = (await this.deps.referenceData.listDesks()).filter((d) => d.isActive);
    return [
      {
        id: 'admin',
        label: 'Amministratore',
        description: 'Operatori, assistenza, Spoki, Sistema',
        role: 'ADMIN',
        deskCode: null,
        username: `${DEV_USERNAME_PREFIX}admin`,
      },
      ...desks.map((d) => ({
        id: `accettatore-${d.code.toLowerCase()}`,
        label: `Accettatore ${d.code}`,
        description: d.name,
        role: 'ADVISOR' as const,
        deskCode: d.code,
        username: `${DEV_USERNAME_PREFIX}accettatore.${d.code.toLowerCase()}`,
      })),
    ];
  }

  /**
   * Sessione per il profilo scelto: l'account `dev.*` viene creato se manca, la postazione è la
   * prima libera dello sportello (o qualunque, se sono tutte occupate: in sviluppo si entra comunque).
   */
  async login(profileId: string): Promise<Result<IssuedSession, DomainError>> {
    const profile = (await this.profiles()).find((p) => p.id === profileId);
    if (profile === undefined) {
      return err(domainError('NOT_FOUND', 'Profilo di accesso veloce sconosciuto.', { profileId }));
    }
    const [desks, workstations] = await Promise.all([
      this.deps.referenceData.listDesks(),
      this.deps.referenceData.listWorkstations(),
    ]);
    const desk: Desk | null =
      profile.deskCode === null ? null : (desks.find((d) => d.code === profile.deskCode) ?? null);
    const candidate = workstations.filter((w) => desk === null || w.deskId === desk.id);
    const deskIds = desk === null ? desks.filter((d) => d.isActive).map((d) => d.id) : [desk.id];
    const operator = await this.ensureOperator(profile, deskIds, candidate[0]?.id ?? null);

    const now = this.deps.clock.nowIso();
    const claims = await this.deps.claims.listActive(now);
    const libera =
      candidate.find(
        (w) => !claims.some((c) => c.workstationId === w.id && c.operatorId !== operator.id),
      ) ??
      candidate[0] ??
      workstations[0];
    if (libera === undefined) {
      return err(domainError('VALIDATION', 'Nessuna accettazione configurata nel seed.'));
    }
    const issued = await this.deps.auth.issueSession(operator, libera);
    this.logger.info('accesso veloce di sviluppo', {
      profile: profile.id,
      username: operator.username,
      workstation: libera.code,
    });
    return ok(issued);
  }

  private async ensureOperator(
    profile: QuickLoginProfile,
    deskIds: readonly Desk['id'][],
    defaultWorkstationId: Workstation['id'] | null,
  ): Promise<Operator> {
    const existing = await this.deps.operators.findByUsername(profile.username);
    if (existing !== null) {
      return existing.isActive
        ? existing
        : this.deps.operators.update({ ...existing, isActive: true });
    }
    return this.deps.operators.insert({
      id: asOperatorId(`dev-${profile.id}`),
      username: profile.username,
      displayName: `Dev · ${profile.label}`,
      role: profile.role,
      deskIds,
      defaultWorkstationId,
      // Password casuale e mai mostrata: l'account si usa solo dal pulsante di accesso veloce.
      passwordHash: hashPassword(randomBytes(24).toString('hex')),
      isActive: true,
      mustChangePassword: false,
      infinityAdvisorCode: null,
    });
  }
}
