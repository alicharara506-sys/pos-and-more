import { Injectable } from '@nestjs/common';
import { Money, computeStockStatus } from '@salesmaster/domain';
import { InvoiceStatus, SaleStatus } from '@salesmaster/database';
import { PrismaService } from '../prisma/prisma.service';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * All dashboard numbers are computed live from real tenant data — never
 * hard-coded or sampled — per spec §1.2. Time windows are computed in
 * server (UTC) time for this phase; full tenant-timezone-aware bucketing is
 * documented as follow-up work in docs/architecture.md.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(tenantId: string, branchId?: string) {
    const now = new Date();
    const todayStart = startOfDay(now);
    const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const saleWhere = { tenantId, branchId, status: SaleStatus.COMPLETED } as const;

    const [
      todaySales,
      weekSales,
      monthSales,
      salesLast30Days,
      expensesLast30Days,
      lowStockVariants,
      pendingInvoices,
      overdueInvoices,
      topProductRows,
    ] = await Promise.all([
      this.prisma.client.sale.aggregate({
        where: { ...saleWhere, createdAt: { gte: todayStart } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.client.sale.aggregate({
        where: { ...saleWhere, createdAt: { gte: sevenDaysAgo } },
        _sum: { total: true },
      }),
      this.prisma.client.sale.aggregate({
        where: { ...saleWhere, createdAt: { gte: monthStart } },
        _sum: { total: true },
      }),
      this.prisma.client.sale.findMany({
        where: { ...saleWhere, createdAt: { gte: thirtyDaysAgo } },
        include: { lines: true },
      }),
      this.prisma.client.expense.aggregate({
        where: { tenantId, branchId, date: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
      }),
      this.prisma.client.productVariant.findMany({
        where: { tenantId, status: 'ACTIVE' },
        include: { inventoryBalances: true },
      }),
      this.prisma.client.invoice.count({
        where: { tenantId, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] } },
      }),
      this.prisma.client.invoice.count({
        where: {
          tenantId,
          status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.client.saleLine.groupBy({
        by: ['variantId'],
        where: { tenantId, sale: { ...saleWhere, createdAt: { gte: thirtyDaysAgo } } },
        _sum: { lineTotal: true, quantity: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 5,
      }),
    ]);

    let costOfGoodsSold = Money.zero('USD');
    let netSales = Money.zero('USD');
    for (const sale of salesLast30Days) {
      for (const line of sale.lines) {
        costOfGoodsSold = costOfGoodsSold.add(
          Money.of(line.unitCost.toString(), 'USD').multiply(line.quantity),
        );
      }
      netSales = netSales.add(Money.of(sale.total.toString(), 'USD'));
    }
    const grossProfit = netSales.subtract(costOfGoodsSold);
    const operatingExpenses = Money.of(expensesLast30Days._sum.amount?.toString() ?? '0', 'USD');
    const netProfit = grossProfit.subtract(operatingExpenses);

    let lowStockCount = 0;
    let outOfStockCount = 0;
    for (const variant of lowStockVariants) {
      const qty = variant.inventoryBalances.reduce((sum, b) => sum + b.quantity, 0);
      const status = computeStockStatus({
        availableQuantity: qty,
        reorderPoint: variant.reorderPoint,
        warningBuffer: variant.reorderBuffer,
      });
      if (status === 'red') {
        if (qty <= 0) outOfStockCount++;
        else lowStockCount++;
      }
    }

    const outstandingReceivables = await this.prisma.client.invoice.aggregate({
      where: {
        tenantId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
      },
      _sum: { total: true, amountPaid: true },
    });
    const outstandingTotal = Money.of(
      outstandingReceivables._sum.total?.toString() ?? '0',
      'USD',
    ).subtract(Money.of(outstandingReceivables._sum.amountPaid?.toString() ?? '0', 'USD'));

    const topProducts = await Promise.all(
      topProductRows.map(async (row) => {
        const variant = await this.prisma.client.productVariant.findUnique({
          where: { id: row.variantId },
          include: { product: true },
        });
        return {
          variantId: row.variantId,
          productName: variant?.product.name ?? 'Unknown',
          sku: variant?.sku,
          revenue: row._sum.lineTotal?.toString() ?? '0',
          quantitySold: row._sum.quantity ?? 0,
        };
      }),
    );

    return {
      currency: 'USD',
      today: {
        total: todaySales._sum.total?.toString() ?? '0',
        transactionCount: todaySales._count,
      },
      last7Days: { total: weekSales._sum.total?.toString() ?? '0' },
      monthToDate: { total: monthSales._sum.total?.toString() ?? '0' },
      profitLast30Days: {
        netSales: netSales.toDecimalString(),
        costOfGoodsSold: costOfGoodsSold.toDecimalString(),
        grossProfit: grossProfit.toDecimalString(),
        operatingExpenses: operatingExpenses.toDecimalString(),
        netProfit: netProfit.toDecimalString(),
      },
      receivables: {
        outstandingTotal: outstandingTotal.toDecimalString(),
        pendingInvoices,
        overdueInvoices,
      },
      inventory: { lowStockCount, outOfStockCount },
      topProducts,
    };
  }
}
