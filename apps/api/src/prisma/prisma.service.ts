import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma, PrismaClient } from '@salesmaster/database';

/**
 * Thin Nest wrapper around the shared Prisma singleton (packages/database)
 * so it participates in Nest's module lifecycle. Every query in every
 * feature module MUST filter by tenantId — see docs/data-model.md and
 * apps/api/test/integration/tenant-isolation.spec.ts.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = prisma;

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
