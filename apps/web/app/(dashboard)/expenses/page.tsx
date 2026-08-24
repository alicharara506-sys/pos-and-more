'use client';

import { useEffect, useState } from 'react';
import { useTenantApi } from '@/lib/use-tenant-api';

interface Expense {
  id: string;
  vendor: string | null;
  amount: string;
  date: string;
  category: { name: string };
}
interface Category {
  id: string;
  name: string;
}
interface Branch {
  id: string;
  name: string;
}

export default function ExpensesPage() {
  const api = useTenantApi();
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    categoryId: '',
    vendor: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
  });
  const [newCategory, setNewCategory] = useState('');

  function load() {
    api<{ expenses: Expense[] }>('/expenses')
      .then((r) => setExpenses(r.expenses))
      .catch((e) => setError(e.message));
    api<Category[]>('/expenses/categories')
      .then(setCategories)
      .catch(() => {});
  }
  useEffect(() => {
    load();
    api<Branch[]>('/branches')
      .then(setBranches)
      .catch(() => {});
  }, [api]);

  async function handleAddCategory() {
    if (!newCategory.trim()) return;
    const cat = await api<Category>('/expenses/categories', {
      method: 'POST',
      body: { name: newCategory },
    });
    setCategories((c) => [...c, cat]);
    setForm((f) => ({ ...f, categoryId: cat.id }));
    setNewCategory('');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!branches[0]) return;
    setError(null);
    try {
      await api('/expenses', {
        method: 'POST',
        body: {
          branchId: branches[0].id,
          categoryId: form.categoryId,
          vendor: form.vendor || undefined,
          amount: Number(form.amount),
          date: form.date,
        },
      });
      setShowForm(false);
      setForm({
        categoryId: '',
        vendor: '',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log expense');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Expenses</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          {showForm ? 'Cancel' : 'Log expense'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card grid grid-cols-2 gap-3 p-4">
          <div className="col-span-2 flex gap-2">
            <select
              required
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">Select category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              placeholder="New category"
              className="w-32 rounded-lg border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-600"
            >
              Add
            </button>
          </div>
          <input
            placeholder="Vendor (optional)"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.vendor}
            onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="Amount"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <input
            required
            type="date"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
          <button className="col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Save expense
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Category</th>
              <th className="p-3">Vendor</th>
              <th className="p-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenses?.map((e) => (
              <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="p-3">{new Date(e.date).toLocaleDateString()}</td>
                <td className="p-3">{e.category.name}</td>
                <td className="p-3 text-gray-500">{e.vendor ?? '—'}</td>
                <td className="p-3">{e.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {expenses && expenses.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-500">No expenses logged yet.</p>
        )}
      </div>
    </div>
  );
}
