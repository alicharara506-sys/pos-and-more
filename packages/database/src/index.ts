import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __salesmasterPrisma: PrismaClient | undefined;
}

/**
 * Singleton Prisma client. Reused across hot reloads in dev so we don't
 * exhaust Postgres connections.
 */
export const prisma =
  global.__salesmasterPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__salesmasterPrisma = prisma;
}

export * from '@prisma/client';
export { Prisma } from '@prisma/client';
