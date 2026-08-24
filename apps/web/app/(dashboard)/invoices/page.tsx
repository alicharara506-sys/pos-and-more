'use client';

import { useEffect, useState } from 'react';
import { useTenantApi } from '@/lib/use-tenant-api';

interface Invoice {
  id: string;
  number: string;
  status: string;
  total: string;
  amountPaid: string;
  currency: string;
  dueDate: string | null;
  publicToken: string;
}
interface Customer {
  id: string;
  name: string;
}
interface Branch {
  id: string;
  name: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export default function InvoicesPage() {
  const api = useTenantApi();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerId: '',
    description: '',
    quantity: '1',
    unitPrice: '',
  });

  function load() {
    api<Invoice[]>('/invoices')
      .then(setInvoices)
      .catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    api<{ customers: Customer[] }>('/customers')
      .then((r) => setCustomers(r.customers))
      .catch(() => {});
    api<Branch[]>('/branches')
      .then(setBranches)
      .catch(() => {});
  }, [api]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!branches[0]) return;
    setError(null);
    try {
      await api('/invoices', {
        method: 'POST',
        body: {
          branchId: branches[0].id,
          customerId: form.customerId,
          currency: 'USD',
          lines: [
            {
              description: form.description,
              quantity: Number(form.quantity),
              unitPrice: Number(form.unitPrice),
              taxAmount: 0,
              discountAmount: 0,
            },
          ],
        },
      });
      setShowForm(false);
      setForm({ customerId: '', description: '', quantity: '1', unitPrice: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invoice');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Invoices</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          {showForm ? 'Cancel' : 'New invoice'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card grid grid-cols-2 gap-3 p-4">
          <select
            required
            className="col-span-2 rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.customerId}
            onChange={(e) => setForm({ ...form, customerId: e.target.value })}
          >
            <option value="">Select customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="Description"
            className="col-span-2 rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <input
            required
            type="number"
            placeholder="Quantity"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="Unit price"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.unitPrice}
            onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
          />
          {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
          <button className="col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Create invoice
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="p-3">Number</th>
              <th className="p-3">Status</th>
              <th className="p-3">Total</th>
              <th className="p-3">Paid</th>
              <th className="p-3">Public link</th>
            </tr>
          </thead>
          <tbody>
            {invoices?.map((inv) => (
              <tr key={inv.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="p-3">{inv.number}</td>
                <td className="p-3">{inv.status}</td>
                <td className="p-3">
                  {inv.currency} {inv.total}
                </td>
                <td className="p-3">
                  {inv.currency} {inv.amountPaid}
                </td>
                <td className="p-3">
                  <a
                    className="text-brand-600 hover:underline"
                    href={`${API_BASE}/public/invoices/${inv.publicToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices && invoices.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-500">No invoices yet.</p>
        )}
      </div>
    </div>
  );
}
