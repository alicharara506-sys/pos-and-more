import { BadRequestException } from '@nestjs/common';
import type { AiToolDefinition } from './ai-adapter.interface';
import type { ReportsService } from '../reports/reports.service';

/**
 * The assistant's entire read-only surface onto tenant data. Deliberately a
 * small, fixed set of business-report queries rather than raw DB/SQL access
 * — the model can only ask questions this codebase already knows how to
 * answer safely and tenant-scoped, never construct an arbitrary query.
 */
export const ASSISTANT_TOOLS: AiToolDefinition[] = [
  {
    name: 'get_sales_summary',
    description:
      'Get total sales, cost of goods sold, gross profit, and transaction count for a date range, bucketed by day, week, or month.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date, ISO format (YYYY-MM-DD)' },
        to: { type: 'string', description: 'End date, ISO format (YYYY-MM-DD)' },
        groupBy: { type: 'string', enum: ['day', 'week', 'month'], description: 'Bucket size' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_low_stock_items',
    description:
      'List products currently at or below their reorder point (red) or in the low-stock warning range (yellow), sorted by quantity ascending.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_inventory_valuation',
    description:
      'Get the total value of on-hand inventory, valued at cost, and a per-product breakdown.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_dashboard_summary',
    description:
      "Get today's, this week's, and month-to-date sales totals, 30-day profit, outstanding receivables, and top-selling products.",
    inputSchema: { type: 'object', properties: {} },
  },
];

/** Binds the fixed tool set to one tenant's data — the only place a tool name maps to a real query. */
export function createToolExecutor(
  tenantId: string,
  reports: ReportsService,
): (name: string, input: Record<string, unknown>) => Promise<unknown> {
  return async (name, input) => {
    switch (name) {
      case 'get_sales_summary': {
        const from = new Date(input.from as string);
        const to = new Date(input.to as string);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
          throw new BadRequestException('Invalid from/to date');
        }
        const groupBy = (input.groupBy as 'day' | 'week' | 'month' | undefined) ?? 'day';
        return reports.getSalesByPeriod(tenantId, from, to, groupBy);
      }
      case 'get_low_stock_items':
        return reports.getLowStockItems(tenantId);
      case 'get_inventory_valuation':
        return reports.getInventoryValuation(tenantId);
      case 'get_dashboard_summary':
        return reports.getDashboard(tenantId);
      default:
        throw new BadRequestException(`Unknown tool: ${name}`);
    }
  };
}
