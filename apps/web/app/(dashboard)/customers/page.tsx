'use client';

import { useEffect, useState } from 'react';
import { useTenantApi } from '@/lib/use-tenant-api';

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  balance: string;
  status: string;
}

export default function CustomersPage() {
  const api = useTenantApi();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<{ customers: Customer[] }>('/customers')
      .then((r) => setCustomers(r.customers))
      .catch((e) => setError(e.message));
  }
  useEffect(load, [api]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/customers', {
        method: 'POST',
        body: { name: form.name, email: form.email || undefined, phone: form.phone || undefined },
      });
      setForm({ name: '', email: '', phone: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create customer');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Customers</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          {showForm ? 'Cancel' : 'Add customer'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card grid grid-cols-3 gap-3 p-4">
          <input
            required
            placeholder="Full name"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Email"
            type="email"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            placeholder="Phone"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          {error && <p className="col-span-3 text-sm text-red-600">{error}</p>}
          <button className="col-span-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Save customer
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Email</th>
              <th className="p-3">Phone</th>
              <th className="p-3">Balance</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {customers?.map((c) => (
              <tr key={c.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="p-3">{c.name}</td>
                <td className="p-3 text-gray-500">{c.email ?? '—'}</td>
                <td className="p-3 text-gray-500">{c.phone ?? '—'}</td>
                <td className="p-3">{c.balance}</td>
                <td className="p-3">{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers && customers.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-500">No customers yet.</p>
        )}
      </div>
    </div>
  );
}
