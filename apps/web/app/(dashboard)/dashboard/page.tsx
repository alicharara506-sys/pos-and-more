'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTenantApi } from '@/lib/use-tenant-api';

interface DashboardData {
  currency: string;
  today: { total: string; transactionCount: number };
  last7Days: { total: string };
  monthToDate: { total: string };
  profitLast30Days: { netSales: string; grossProfit: string; netProfit: string };
  receivables: { outstandingTotal: string; pendingInvoices: number; overdueInvoices: number };
  inventory: { lowStockCount: number; outOfStockCount: number };
  topProducts: Array<{ productName: string; sku?: string; revenue: string; quantitySold: number }>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const api = useTenantApi();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DashboardData>('/reports/dashboard')
      .then(setData)
      .catch((e) => setError(e.message));
  }, [api]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading dashboard…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-gray-500">
          Live numbers from your actual sales, inventory, and invoices.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Today's sales"
          value={`${data.currency} ${data.today.total}`}
          sub={`${data.today.transactionCount} transactions`}
        />
        <Stat label="Last 7 days" value={`${data.currency} ${data.last7Days.total}`} />
        <Stat label="Month to date" value={`${data.currency} ${data.monthToDate.total}`} />
        <Stat
          label="Net profit (30d)"
          value={`${data.currency} ${data.profitLast30Days.netProfit}`}
          sub={`Gross: ${data.profitLast30Days.grossProfit}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link href="/customers" className="card block p-4 hover:border-brand-500">
          <p className="text-xs text-gray-500">Outstanding receivables</p>
          <p className="mt-1 text-xl font-semibold">
            {data.currency} {data.receivables.outstandingTotal}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {data.receivables.pendingInvoices} pending · {data.receivables.overdueInvoices} overdue
          </p>
        </Link>
        <Link href="/products?stockStatus=red" className="card block p-4 hover:border-brand-500">
          <p className="text-xs text-gray-500">Out of stock / low</p>
          <p className="mt-1 text-xl font-semibold text-stock-red">
            {data.inventory.outOfStockCount + data.inventory.lowStockCount}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {data.inventory.outOfStockCount} out · {data.inventory.lowStockCount} low
          </p>
        </Link>
        <div className="card p-4">
          <p className="mb-2 text-xs text-gray-500">Quick actions</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/pos"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              New sale
            </Link>
            <Link
              href="/products"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
            >
              Add product
            </Link>
            <Link
              href="/customers"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
            >
              Add customer
            </Link>
            <Link
              href="/expenses"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
            >
              Log expense
            </Link>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <p className="mb-3 text-sm font-medium">Top products — last 30 days</p>
        {data.topProducts.length === 0 ? (
          <p className="text-sm text-gray-500">
            No sales yet. Once you record sales in the POS, your best sellers show up here.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="pb-2">Product</th>
                <th className="pb-2">Qty sold</th>
                <th className="pb-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.map((p) => (
                <tr
                  key={p.sku ?? p.productName}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="py-2">{p.productName}</td>
                  <td className="py-2">{p.quantitySold}</td>
                  <td className="py-2">
                    {data.currency} {p.revenue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
