// Gli account degli operatori su SQLite: chi crea l'amministratore da `/admin` resta anche dopo il
// riavvio, la password provvisoria non torna a ogni avvio, il reset è un reset.
//
// Il seed entra una volta sola: alla prima chiamata, se la tabella è vuota, gli operatori del seed
// (l'amministratore iniziale, gli account di sviluppo) vengono scritti; da lì in avanti il database
// è la verità e il seed non lo tocca più. Farlo qui, e non nel container, perché il container è
// sincrono e il database no: ogni metodo aspetta `pronto` prima di leggere.
import { OPERATOR_ROLES, type Operator, type OperatorRole } from '@/domain/entities/operator';
import type { DeskId, OperatorId, WorkstationId } from '@/domain/ids';
import type { Operator as Row } from '@/generated/prisma/client';
import type { IOperatorRepository } from '../interfaces/IOperatorRepository';
import type { Db } from './client';
import { fromJson, toJson } from './json';

/** Un ruolo che il dominio non conosce più (es. SUPERVISOR, tolto il 2026-09-24) non entra. */
function isKnownRole(role: string): role is OperatorRole {
  return (OPERATOR_ROLES as readonly string[]).includes(role);
}

function toEntity(r: Row): Operator {
  const ruolo = isKnownRole(r.role) ? r.role : null;
  return {
    id: r.id as OperatorId,
    username: r.username,
    displayName: r.displayName,
    // Ruolo sconosciuto: account disattivato da accettatore, mai un ruolo inventato.
    role: ruolo ?? 'ADVISOR',
    deskIds: fromJson<DeskId[]>(r.deskIdsJson, 'deskIdsJson'),
    defaultWorkstationId: r.defaultWorkstationId as WorkstationId | null,
    passwordHash: r.passwordHash,
    isActive: ruolo !== null && r.isActive,
    mustChangePassword: r.mustChangePassword,
  };
}

function toRow(o: Operator): Row {
  return {
    id: o.id,
    username: o.username,
    displayName: o.displayName,
    role: o.role,
    deskIdsJson: toJson(o.deskIds),
    defaultWorkstationId: o.defaultWorkstationId,
    passwordHash: o.passwordHash,
    isActive: o.isActive,
    mustChangePassword: o.mustChangePassword,
  };
}

export class PrismaOperatorRepository implements IOperatorRepository {
  private pronto: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    /** Operatori da scrivere se la tabella è vuota (primo avvio). */
    private readonly seed: readonly Operator[] = [],
  ) {}

  private ensureSeeded(): Promise<void> {
    this.pronto ??= (async () => {
      if (this.seed.length === 0 || (await this.db.operator.count()) > 0) {
        return;
      }
      for (const o of this.seed) {
        await this.db.operator.create({ data: toRow(o) });
      }
    })();
    return this.pronto;
  }

  async findById(id: OperatorId): Promise<Operator | null> {
    await this.ensureSeeded();
    const r = await this.db.operator.findUnique({ where: { id } });
    return r === null ? null : toEntity(r);
  }

  async findByUsername(username: string): Promise<Operator | null> {
    await this.ensureSeeded();
    // Confronto senza distinguere le maiuscole, come in memoria: gli operatori sono pochi e
    // SQLite in Prisma non ha un `equals` insensibile alle maiuscole.
    const wanted = username.trim().toLowerCase();
    const rows = await this.db.operator.findMany();
    const r = rows.find((o) => o.username.toLowerCase() === wanted);
    return r === undefined ? null : toEntity(r);
  }

  async listActive(): Promise<readonly Operator[]> {
    await this.ensureSeeded();
    return (await this.db.operator.findMany({ where: { isActive: true } })).map(toEntity);
  }

  async listAll(): Promise<readonly Operator[]> {
    await this.ensureSeeded();
    return (await this.db.operator.findMany()).map(toEntity);
  }

  /** Upsert per id, come in memoria. */
  async insert(operator: Operator): Promise<Operator> {
    await this.ensureSeeded();
    const riga = toRow(operator);
    const { id: _id, ...dati } = riga;
    return toEntity(
      await this.db.operator.upsert({ where: { id: operator.id }, create: riga, update: dati }),
    );
  }

  async update(operator: Operator): Promise<Operator> {
    return this.insert(operator);
  }
}
