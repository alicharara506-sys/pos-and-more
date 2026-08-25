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

  /**
   * Buckets completed sales into day/week/month periods over [from, to] —
   * every period in range is present in the output, zero-filled, so a chart
   * or table never has to guess whether a missing key means "no sales" or
   * "not computed yet". Bucketing is server (UTC) time, same documented
   * limitation as getDashboard.
   */
  async getSalesByPeriod(
    tenantId: string,
    from: Date,
    to: Date,
    groupBy: 'day' | 'week' | 'month',
    branchId?: string,
  ) {
    // `to` is a calendar date (e.g. from a <input type="date">, or a bare
    // "2026-08-25" query param) that coerces to that day's midnight — an
    // inclusive "through end of `to`" range needs the boundary pushed to
    // the start of the following day, or every sale made today would be
    // silently excluded from a report ending "today".
    const toExclusive = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1),
    );
    const sales = await this.prisma.client.sale.findMany({
      where: {
        tenantId,
        branchId,
        status: SaleStatus.COMPLETED,
        createdAt: { gte: from, lt: toExclusive },
      },
      include: { lines: true },
      orderBy: { createdAt: 'asc' },
    });

    const buckets = new Map<
      string,
      { periodStart: Date; total: Money; costOfGoodsSold: Money; transactionCount: number }
    >();
    for (const key of enumeratePeriods(from, to, groupBy)) {
      buckets.set(key.label, {
        periodStart: key.start,
        total: Money.zero('USD'),
        costOfGoodsSold: Money.zero('USD'),
        transactionCount: 0,
      });
    }

    for (const sale of sales) {
      const label = periodLabel(sale.createdAt, groupBy);
      const bucket = buckets.get(label);
      if (!bucket) continue; // outside range due to a boundary rounding edge — never crash a report over it
      bucket.total = bucket.total.add(Money.of(sale.total.toString(), 'USD'));
      bucket.transactionCount += 1;
      for (const line of sale.lines) {
        bucket.costOfGoodsSold = bucket.costOfGoodsSold.add(
          Money.of(line.unitCost.toString(), 'USD').multiply(line.quantity),
        );
      }
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[1].periodStart.getTime() - b[1].periodStart.getTime())
      .map(([period, b]) => ({
        period,
        total: b.total.toDecimalString(),
        costOfGoodsSold: b.costOfGoodsSold.toDecimalString(),
        grossProfit: b.total.subtract(b.costOfGoodsSold).toDecimalString(),
        transactionCount: b.transactionCount,
      }));
  }

  async salesReportCsv(
    tenantId: string,
    from: Date,
    to: Date,
    groupBy: 'day' | 'week' | 'month',
    branchId?: string,
  ): Promise<string> {
    const rows = await this.getSalesByPeriod(tenantId, from, to, groupBy, branchId);
    const header = 'period,total,cost_of_goods_sold,gross_profit,transaction_count';
    const lines = rows.map((r) =>
      [r.period, r.total, r.costOfGoodsSold, r.grossProfit, r.transactionCount].join(','),
    );
    return [header, ...lines].join('\n');
  }

  /**
   * Current stock, valued at cost — sum(on-hand quantity × costPrice) per
   * variant, across every stock location. Decimal-safe throughout; never
   * floating-point multiplication of a currency amount.
   */
  async getInventoryValuation(tenantId: string) {
    const variants = await this.prisma.client.productVariant.findMany({
      where: { tenantId },
      include: { product: true, inventoryBalances: true },
    });

    let grandTotal = Money.zero('USD');
    const items = variants
      .map((variant) => {
        const quantity = variant.inventoryBalances.reduce((sum, b) => sum + b.quantity, 0);
        const value = Money.of(variant.costPrice.toString(), 'USD').multiply(quantity);
        grandTotal = grandTotal.add(value);
        return {
          variantId: variant.id,
          productName: variant.product.name,
          sku: variant.sku,
          quantity,
          costPrice: variant.costPrice.toString(),
          value: value.toDecimalString(),
        };
      })
      .filter((item) => item.quantity !== 0);

    return { currency: 'USD', totalValue: grandTotal.toDecimalString(), items };
  }
}

function periodLabel(date: Date, groupBy: 'day' | 'week' | 'month'): string {
  if (groupBy === 'month') {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (groupBy === 'week') {
    const start = startOfWeekUTC(date);
    return start.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function startOfWeekUTC(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function enumeratePeriods(
  from: Date,
  to: Date,
  groupBy: 'day' | 'week' | 'month',
): Array<{ label: string; start: Date }> {
  const periods: Array<{ label: string; start: Date }> = [];
  const seen = new Set<string>();
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  while (cursor.getTime() <= end.getTime()) {
    const label = periodLabel(cursor, groupBy);
    if (!seen.has(label)) {
      seen.add(label);
      const start =
        groupBy === 'week'
          ? startOfWeekUTC(cursor)
          : groupBy === 'month'
            ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1))
            : new Date(cursor);
      periods.push({ label, start });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return periods;
}
