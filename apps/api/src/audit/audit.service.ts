import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@salesmaster/database';

export interface RecordAuditEventInput {
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

type PrismaTx = Prisma.TransactionClient;

/**
 * AuditEvent rows are append-only (no update/delete path exists anywhere in
 * the codebase) so they stay tamper-evident. Pass `tx` to write the audit
 * row inside the same transaction as the action it describes, so an audit
 * record can never exist for a write that was rolled back (or vice versa).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput, tx?: PrismaTx): Promise<void> {
    const client = tx ?? this.prisma.client;
    await client.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: input.ipAddress,
      },
    });
  }
}
