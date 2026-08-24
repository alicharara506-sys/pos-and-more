import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryMovementType, StockTransferStatus, type Prisma } from '@salesmaster/database';
import type {
  CreateInventoryAdjustmentInput,
  CreateStockTransferInput,
} from '@salesmaster/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type PrismaTx = Prisma.TransactionClient;

export interface RecordMovementInput {
  tenantId: string;
  branchId: string;
  stockLocationId: string;
  variantId: string;
  type: InventoryMovementType;
  quantityDelta: number;
  reason?: string;
  actorUserId?: string;
  sourceType?: string;
  sourceId?: string;
  idempotencyKey?: string;
}

/**
 * The inventory ledger. InventoryMovement rows are append-only; the
 * InventoryBalance row per (stockLocation, variant) is a maintained
 * projection, never the source of truth (docs/data-model.md §Inventory).
 * `upsert` on the balance's unique constraint gives us atomic,
 * concurrency-safe increments — Postgres serializes concurrent writers on
 * that row's lock, so two simultaneous sales for the last unit cannot both
 * "succeed" and oversell.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async recordMovement(input: RecordMovementInput, tx: PrismaTx) {
    if (input.idempotencyKey) {
      const existing = await tx.inventoryMovement.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return existing;
    }

    const balance = await tx.inventoryBalance.upsert({
      where: {
        stockLocationId_variantId: {
          stockLocationId: input.stockLocationId,
          variantId: input.variantId,
        },
      },
      create: {
        tenantId: input.tenantId,
        stockLocationId: input.stockLocationId,
        variantId: input.variantId,
        quantity: input.quantityDelta,
      },
      update: { quantity: { increment: input.quantityDelta } },
    });

    return tx.inventoryMovement.create({
      data: {
        tenantId: input.tenantId,
        branchId: input.branchId,
        stockLocationId: input.stockLocationId,
        variantId: input.variantId,
        type: input.type,
        quantityDelta: input.quantityDelta,
        resultingBalance: balance.quantity,
        reason: input.reason,
        actorUserId: input.actorUserId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  async adjustStock(tenantId: string, actorUserId: string, input: CreateInventoryAdjustmentInput) {
    const stockLocation = await this.prisma.client.stockLocation.findFirst({
      where: { id: input.stockLocationId, tenantId },
    });
    if (!stockLocation) throw new NotFoundException('Stock location not found');

    return this.prisma.client.$transaction(async (tx) => {
      const movement = await this.recordMovement(
        {
          tenantId,
          branchId: stockLocation.branchId,
          stockLocationId: input.stockLocationId,
          variantId: input.variantId,
          type: input.type,
          quantityDelta: input.quantityDelta,
          reason: input.reason,
          actorUserId,
          sourceType: 'manual',
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );
      await this.audit.record(
        {
          tenantId,
          actorUserId,
          action: 'inventory.adjusted',
          entityType: 'InventoryMovement',
          entityId: movement.id,
          metadata: {
            variantId: input.variantId,
            quantityDelta: input.quantityDelta,
            reason: input.reason,
          },
        },
        tx,
      );
      return movement;
    });
  }

  async transferStock(tenantId: string, actorUserId: string, input: CreateStockTransferInput) {
    if (input.fromStockLocationId === input.toStockLocationId) {
      throw new BadRequestException('Source and destination stock locations must differ');
    }

    const [from, to] = await Promise.all([
      this.prisma.client.stockLocation.findFirst({
        where: { id: input.fromStockLocationId, tenantId },
      }),
      this.prisma.client.stockLocation.findFirst({
        where: { id: input.toStockLocationId, tenantId },
      }),
    ]);
    if (!from || !to) throw new NotFoundException('Stock location not found');

    return this.prisma.client.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.create({
        data: {
          tenantId,
          fromStockLocationId: from.id,
          toStockLocationId: to.id,
          status: StockTransferStatus.RECEIVED, // MVP: immediate transfer, no separate approval step yet
          note: input.note,
          initiatedByUserId: actorUserId,
          receivedAt: new Date(),
          lines: {
            create: input.lines.map((l) => ({
              tenantId,
              variantId: l.variantId,
              quantity: l.quantity,
            })),
          },
        },
        include: { lines: true },
      });

      for (const line of input.lines) {
        await this.recordMovement(
          {
            tenantId,
            branchId: from.branchId,
            stockLocationId: from.id,
            variantId: line.variantId,
            type: InventoryMovementType.TRANSFER_DISPATCH,
            quantityDelta: -line.quantity,
            actorUserId,
            sourceType: 'stock_transfer',
            sourceId: transfer.id,
          },
          tx,
        );
        await this.recordMovement(
          {
            tenantId,
            branchId: to.branchId,
            stockLocationId: to.id,
            variantId: line.variantId,
            type: InventoryMovementType.TRANSFER_RECEIPT,
            quantityDelta: line.quantity,
            actorUserId,
            sourceType: 'stock_transfer',
            sourceId: transfer.id,
          },
          tx,
        );
      }

      await this.audit.record(
        {
          tenantId,
          actorUserId,
          action: 'inventory.transferred',
          entityType: 'StockTransfer',
          entityId: transfer.id,
        },
        tx,
      );

      return transfer;
    });
  }

  async listMovements(tenantId: string, stockLocationId: string, variantId: string) {
    return this.prisma.client.inventoryMovement.findMany({
      where: { tenantId, stockLocationId, variantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
