import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Money } from '@salesmaster/domain';
import {
  InventoryMovementType,
  PaymentStatus,
  SaleStatus,
  type Prisma,
} from '@salesmaster/database';
import type { CreateSaleInput, ListSalesQuery, RefundSaleInput } from '@salesmaster/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { OutboxService } from '../outbox/outbox.service';

type PrismaTx = Prisma.TransactionClient;

/**
 * POS sale creation. All monetary math runs through Money (decimal-safe,
 * never JS `number` arithmetic) and every total is computed server-side
 * from the variant's current price/tax/cost — the client only supplies
 * quantities, optional price overrides, and discounts, matching spec §8
 * "financial totals must be calculated server-side using decimal-safe
 * monetary types" and "preserve the price/tax/cost snapshot used at
 * transaction time" (unitCost is captured on the SaleLine at sale time).
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly outbox: OutboxService,
  ) {}

  async createSale(tenantId: string, actorUserId: string, input: CreateSaleInput) {
    // Offline-sync idempotency: replaying the same clientMutationId must
    // never create a second sale (spec §9, acceptance test #11).
    const existing = await this.prisma.client.sale.findUnique({
      where: { tenantId_clientMutationId: { tenantId, clientMutationId: input.clientMutationId } },
      include: { lines: true, payments: true },
    });
    if (existing) return existing;

    const branch = await this.prisma.client.branch.findFirst({
      where: { id: input.branchId, tenantId },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const stockLocation = await this.prisma.client.stockLocation.findFirst({
      where: { id: input.stockLocationId, tenantId, branchId: input.branchId },
    });
    if (!stockLocation) throw new NotFoundException('Stock location not found for this branch');

    const variantIds = input.lines.map((l) => l.variantId);
    const variants = await this.prisma.client.productVariant.findMany({
      where: { id: { in: variantIds }, tenantId },
      include: { taxClass: true },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    for (const line of input.lines) {
      if (!variantById.has(line.variantId)) {
        throw new NotFoundException(`Product variant ${line.variantId} not found`);
      }
    }

    const currency = input.currency;
    let subtotal = Money.zero(currency);
    let taxTotal = Money.zero(currency);
    let discountTotal = Money.zero(currency);

    const computedLines = input.lines.map((line) => {
      const variant = variantById.get(line.variantId)!;
      const unitPrice = Money.of(
        line.unitPriceOverride ?? variant.retailPrice.toString(),
        currency,
      );
      const discount = Money.of(line.discountAmount, currency);
      const lineSubtotal = unitPrice.multiply(line.quantity).subtract(discount);
      const taxRate = variant.taxClass?.ratePercent.toString() ?? '0';
      const tax = lineSubtotal.percentage(taxRate).round();
      const lineTotal = lineSubtotal.add(tax);

      subtotal = subtotal.add(unitPrice.multiply(line.quantity));
      taxTotal = taxTotal.add(tax);
      discountTotal = discountTotal.add(discount);

      return {
        variant,
        quantity: line.quantity,
        unitPrice,
        unitCost: Money.of(variant.costPrice.toString(), currency),
        taxAmount: tax,
        discountAmount: discount,
        lineTotal,
      };
    });

    const total = subtotal.subtract(discountTotal).add(taxTotal);

    const paymentsTotal = input.payments.reduce(
      (sum, p) => sum.add(Money.of(p.amount, currency)),
      Money.zero(currency),
    );
    if (paymentsTotal.compare(total) !== 0) {
      throw new BadRequestException(
        `Payments (${paymentsTotal.toDecimalString()}) must equal the sale total (${total.toDecimalString()})`,
      );
    }

    const sale = await this.prisma.client.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          tenantId,
          branchId: input.branchId,
          registerId: input.registerId,
          customerId: input.customerId,
          salespersonUserId: actorUserId,
          status: SaleStatus.COMPLETED,
          subtotal: subtotal.toDecimalString(),
          taxTotal: taxTotal.toDecimalString(),
          discountTotal: discountTotal.toDecimalString(),
          total: total.toDecimalString(),
          currency,
          note: input.note,
          clientMutationId: input.clientMutationId,
          lines: {
            create: computedLines.map((l) => ({
              tenantId,
              variantId: l.variant.id,
              quantity: l.quantity,
              unitPrice: l.unitPrice.toDecimalString(),
              unitCost: l.unitCost.toDecimalString(),
              taxAmount: l.taxAmount.toDecimalString(),
              discountAmount: l.discountAmount.toDecimalString(),
              lineTotal: l.lineTotal.toDecimalString(),
            })),
          },
          payments: {
            create: input.payments.map((p) => ({
              tenantId,
              method: p.method,
              amount: p.amount.toString(),
              currency,
              reference: p.reference,
              status: PaymentStatus.COMPLETED,
            })),
          },
        },
        include: { lines: true, payments: true },
      });

      for (const line of computedLines) {
        await this.inventory.recordMovement(
          {
            tenantId,
            branchId: input.branchId,
            stockLocationId: input.stockLocationId,
            variantId: line.variant.id,
            type: InventoryMovementType.SALE,
            quantityDelta: -line.quantity,
            actorUserId,
            sourceType: 'sale',
            sourceId: sale.id,
            idempotencyKey: `sale:${sale.id}:${line.variant.id}`,
          },
          tx,
        );
      }

      if (input.customerId) {
        const creditPortion = input.payments
          .filter((p) => p.method === 'CUSTOMER_CREDIT')
          .reduce((sum, p) => sum.add(Money.of(p.amount, currency)), Money.zero(currency));
        if (!creditPortion.isZero()) {
          await tx.customer.update({
            where: { id: input.customerId },
            data: { balance: { increment: creditPortion.toDecimalString() } },
          });
        }
      }

      await this.audit.record(
        {
          tenantId,
          actorUserId,
          action: 'sales.created',
          entityType: 'Sale',
          entityId: sale.id,
          metadata: { total: total.toDecimalString() },
        },
        tx,
      );
      await this.outbox.publish(
        {
          aggregateType: 'Sale',
          aggregateId: sale.id,
          eventType: 'sale.created',
          payload: { saleId: sale.id, tenantId },
        },
        tx,
      );

      return sale;
    });

    return sale;
  }

  async refundSale(tenantId: string, actorUserId: string, saleId: string, input: RefundSaleInput) {
    const sale = await this.prisma.client.sale.findFirst({
      where: { id: saleId, tenantId },
      include: { lines: true, refunds: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status !== SaleStatus.COMPLETED && sale.status !== SaleStatus.PARTIALLY_REFUNDED) {
      throw new BadRequestException(`Cannot refund a sale with status ${sale.status}`);
    }

    const currency = sale.currency;
    const total = Money.of(sale.total.toString(), currency);
    const alreadyRefunded = sale.refunds.reduce(
      (sum, r) => sum.add(Money.of(r.amount.toString(), currency)),
      Money.zero(currency),
    );
    const refundAmount =
      input.amount != null ? Money.of(input.amount, currency) : total.subtract(alreadyRefunded);

    if (refundAmount.isNegative() || refundAmount.isZero()) {
      throw new BadRequestException('Refund amount must be positive');
    }
    if (alreadyRefunded.add(refundAmount).compare(total) > 0) {
      throw new BadRequestException('Refund amount exceeds the remaining refundable balance');
    }

    const isFullRefund = alreadyRefunded.add(refundAmount).compare(total) === 0;

    return this.prisma.client.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          tenantId,
          saleId,
          amount: refundAmount.toDecimalString(),
          reason: input.reason,
          processedByUserId: actorUserId,
        },
      });

      await tx.sale.update({
        where: { id: saleId },
        data: { status: isFullRefund ? SaleStatus.REFUNDED : SaleStatus.PARTIALLY_REFUNDED },
      });

      if (input.restock && isFullRefund) {
        const saleStockLocation = await tx.stockLocation.findFirst({
          where: { tenantId, branchId: sale.branchId, isDefault: true },
        });
        if (saleStockLocation) {
          for (const line of sale.lines) {
            await this.inventory.recordMovement(
              {
                tenantId,
                branchId: sale.branchId,
                stockLocationId: saleStockLocation.id,
                variantId: line.variantId,
                type: InventoryMovementType.SALE_RETURN,
                quantityDelta: line.quantity,
                actorUserId,
                sourceType: 'refund',
                sourceId: refund.id,
                idempotencyKey: `refund:${refund.id}:${line.variantId}`,
              },
              tx,
            );
          }
        }
      }

      await this.audit.record(
        {
          tenantId,
          actorUserId,
          action: 'sales.refunded',
          entityType: 'Sale',
          entityId: saleId,
          metadata: { amount: refundAmount.toDecimalString() },
        },
        tx,
      );
      await this.outbox.publish(
        {
          aggregateType: 'Sale',
          aggregateId: saleId,
          eventType: 'sale.refunded',
          payload: { saleId, tenantId, amount: refundAmount.toDecimalString() },
        },
        tx,
      );

      return refund;
    });
  }

  async voidSale(tenantId: string, actorUserId: string, saleId: string) {
    const sale = await this.prisma.client.sale.findFirst({ where: { id: saleId, tenantId } });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status !== SaleStatus.OPEN) {
      throw new ForbiddenException(
        'Only open (uncompleted) sales can be voided; completed sales must be refunded',
      );
    }
    const voided = await this.prisma.client.sale.update({
      where: { id: saleId },
      data: { status: SaleStatus.VOIDED, voidedAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'sales.voided',
      entityType: 'Sale',
      entityId: saleId,
    });
    return voided;
  }

  async list(tenantId: string, query: ListSalesQuery) {
    const sales = await this.prisma.client.sale.findMany({
      where: {
        tenantId,
        branchId: query.branchId,
        customerId: query.customerId,
        status: query.status,
        createdAt: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
      },
      include: { lines: true, payments: true },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
    });
    return { sales, page: query.page, pageSize: query.pageSize };
  }

  async get(tenantId: string, saleId: string) {
    const sale = await this.prisma.client.sale.findFirst({
      where: { id: saleId, tenantId },
      include: { lines: true, payments: true, refunds: true, customer: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }
}
