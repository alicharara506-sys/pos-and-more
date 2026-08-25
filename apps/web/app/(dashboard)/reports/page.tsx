'use client';

import { useEffect, useState } from 'react';
import { useTenantApi } from '@/lib/use-tenant-api';
import { useSession } from '@/lib/session-context';

interface SalesPeriod {
  period: string;
  total: string;
  costOfGoodsSold: string;
  grossProfit: string;
  transactionCount: number;
}

interface ValuationItem {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  costPrice: string;
  value: string;
}

interface InventoryValuation {
  currency: string;
  totalValue: string;
  items: ValuationItem[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const api = useTenantApi();
  const { currentTenantId } = useSession();
  const [from, setFrom] = useState(daysAgoIso(6));
  const [to, setTo] = useState(todayIso());
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [sales, setSales] = useState<SalesPeriod[] | null>(null);
  const [valuation, setValuation] = useState<InventoryValuation | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadSales() {
    api<SalesPeriod[]>('/reports/sales', { query: { from, to, groupBy } })
      .then(setSales)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load sales report'));
  }

  useEffect(loadSales, [api, from, to, groupBy]);
  useEffect(() => {
    api<InventoryValuation>('/reports/inventory-valuation')
      .then(setValuation)
      .catch(() => {});
  }, [api]);

  async function downloadCsv() {
    if (!currentTenantId) return;
    try {
      const res = await fetch(
        `${API_BASE}/reports/sales/export.csv?from=${from}&to=${to}&groupBy=${groupBy}`,
        { credentials: 'include', headers: { 'X-Tenant-Id': currentTenantId } },
      );
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-report-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download CSV');
    }
  }

  const totals = sales?.reduce(
    (acc, p) => ({
      total: acc.total + Number(p.total),
      grossProfit: acc.grossProfit + Number(p.grossProfit),
      transactionCount: acc.transactionCount + p.transactionCount,
    }),
    { total: 0, grossProfit: 0, transactionCount: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Reports</h1>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          From
          <input
            type="date"
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          To
          <input
            type="date"
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Group by
          <select
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'day' | 'week' | 'month')}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <button
          onClick={downloadCsv}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium dark:border-gray-600"
        >
          Download CSV
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-500">Sales over time</h2>
        {totals && (
          <div className="mb-3 flex gap-6 text-sm">
            <span>
              Total: <strong>{totals.total.toFixed(2)}</strong>
            </span>
            <span>
              Gross profit: <strong>{totals.grossProfit.toFixed(2)}</strong>
            </span>
            <span>
              Transactions: <strong>{totals.transactionCount}</strong>
            </span>
          </div>
        )}
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="p-2">Period</th>
              <th className="p-2">Total</th>
              <th className="p-2">Cost of goods</th>
              <th className="p-2">Gross profit</th>
              <th className="p-2">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {sales?.map((p) => (
              <tr key={p.period} className="border-t border-gray-100 dark:border-gray-800">
                <td className="p-2">{p.period}</td>
                <td className="p-2">{p.total}</td>
                <td className="p-2">{p.costOfGoodsSold}</td>
                <td className="p-2">{p.grossProfit}</td>
                <td className="p-2">{p.transactionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sales && sales.length === 0 && (
          <p className="p-4 text-center text-sm text-gray-500">No data in this range.</p>
        )}
      </div>

      <div className="card overflow-x-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-500">Inventory valuation</h2>
          {valuation && (
            <span className="text-sm">
              Total value:{' '}
              <strong>
                {valuation.currency} {valuation.totalValue}
              </strong>
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="p-2">Product</th>
              <th className="p-2">SKU</th>
              <th className="p-2">On hand</th>
              <th className="p-2">Cost</th>
              <th className="p-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {valuation?.items.map((item) => (
              <tr key={item.variantId} className="border-t border-gray-100 dark:border-gray-800">
                <td className="p-2">{item.productName}</td>
                <td className="p-2 text-gray-500">{item.sku}</td>
                <td className="p-2">{item.quantity}</td>
                <td className="p-2">{item.costPrice}</td>
                <td className="p-2">{item.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {valuation && valuation.items.length === 0 && (
          <p className="p-4 text-center text-sm text-gray-500">No stock on hand.</p>
        )}
      </div>
    </div>
  );
}
