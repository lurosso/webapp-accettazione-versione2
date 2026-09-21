// Persistenza su SQLite tramite Prisma: una classe per interfaccia, più il client. L'unico
// importatore ammesso è `repositories/factory.ts` (regola ESLint `no-restricted-imports`).
export { createPrismaClient, getSharedPrismaClient, type Db } from './client';
export { PrismaAppointmentRepository } from './PrismaAppointmentRepository';
export { PrismaCrmOutboxRepository } from './PrismaCrmOutboxRepository';
export { PrismaMediaRepository } from './PrismaMediaRepository';
export { PrismaNotificationRepository } from './PrismaNotificationRepository';
export { PrismaOperatorRepository } from './PrismaOperatorRepository';
export { PrismaSyncRunRepository } from './PrismaSyncRunRepository';
export { PrismaWorkstationClaimRepository } from './PrismaWorkstationClaimRepository';
