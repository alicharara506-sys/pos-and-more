'use client';

import { useEffect, useState } from 'react';
import { useTenantApi } from '@/lib/use-tenant-api';
import { StockBadge } from '@/components/stock-badge';

interface Variant {
  id: string;
  sku: string;
  barcode: string | null;
  retailPrice: string;
  costPrice: string;
  availableQuantity: number;
  stockStatus: 'red' | 'yellow' | 'green';
}
interface Product {
  id: string;
  name: string;
  brand: string | null;
  status: string;
  variants: Variant[];
}

export default function ProductsPage() {
  const api = useTenantApi();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [qrVariantId, setQrVariantId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    costPrice: '',
    retailPrice: '',
    reorderPoint: '5',
  });
  const [submitting, setSubmitting] = useState(false);

  function load() {
    api<{ products: Product[] }>('/products')
      .then((r) => setProducts(r.products))
      .catch((e) => setError(e.message));
  }

  useEffect(load, [api]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/products', {
        method: 'POST',
        body: {
          name: form.name,
          variants: [
            {
              sku: form.sku,
              barcode: form.barcode || undefined,
              costPrice: Number(form.costPrice),
              retailPrice: Number(form.retailPrice),
              reorderPoint: Number(form.reorderPoint),
              reorderBuffer: 3,
            },
          ],
        },
      });
      setForm({
        name: '',
        sku: '',
        barcode: '',
        costPrice: '',
        retailPrice: '',
        reorderPoint: '5',
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create product');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleQr(variantId: string) {
    if (qrVariantId === variantId) {
      setQrVariantId(null);
      setQrDataUrl(null);
      return;
    }
    setQrVariantId(variantId);
    setQrDataUrl(null);
    try {
      const result = await api<{ dataUrl: string }>(`/products/variants/${variantId}/qr`);
      setQrDataUrl(result.dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load QR code');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Products</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          {showForm ? 'Cancel' : 'Add product'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card grid grid-cols-2 gap-3 p-4">
          <input
            required
            placeholder="Product name"
            className="col-span-2 rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            required
            placeholder="SKU"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
          />
          <input
            placeholder="Barcode (optional)"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.barcode}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="Cost price"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.costPrice}
            onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="Retail price"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.retailPrice}
            onChange={(e) => setForm({ ...form, retailPrice: e.target.value })}
          />
          <input
            type="number"
            placeholder="Reorder point"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.reorderPoint}
            onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })}
          />
          {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
          <button
            disabled={submitting}
            className="col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save product
          </button>
        </form>
      )}

      {error && !showForm && <p className="text-sm text-red-600">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">SKU</th>
              <th className="p-3">Cost</th>
              <th className="p-3">Retail</th>
              <th className="p-3">Stock</th>
              <th className="p-3">Label</th>
            </tr>
          </thead>
          <tbody>
            {products?.flatMap((p) =>
              p.variants.flatMap((v) => [
                <tr key={v.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="p-3">{p.name}</td>
                  <td className="p-3 text-gray-500">{v.sku}</td>
                  <td className="p-3">{v.costPrice}</td>
                  <td className="p-3">{v.retailPrice}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <StockBadge status={v.stockStatus} />
                      <span className="text-xs text-gray-400">{v.availableQuantity} on hand</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleQr(v.id)}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      {qrVariantId === v.id ? 'Hide QR' : 'QR code'}
                    </button>
                  </td>
                </tr>,
                qrVariantId === v.id ? (
                  <tr key={`${v.id}-qr`} className="border-t border-gray-100 dark:border-gray-800">
                    <td colSpan={6} className="p-3">
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt={`QR code for SKU ${v.sku}`}
                          className="h-32 w-32"
                        />
                      ) : (
                        <p className="text-sm text-gray-500">Loading…</p>
                      )}
                    </td>
                  </tr>
                ) : null,
              ]),
            )}
          </tbody>
        </table>
        {products && products.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-500">
            No products yet. Add your first one above.
          </p>
        )}
      </div>
    </div>
  );
}
