'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTenantApi } from '@/lib/use-tenant-api';

interface Variant {
  id: string;
  sku: string;
  retailPrice: string;
  availableQuantity: number;
  stockStatus: 'red' | 'yellow' | 'green';
}
interface Product {
  id: string;
  name: string;
  variants: Variant[];
}
interface Branch {
  id: string;
  name: string;
  stockLocations: Array<{ id: string; isDefault: boolean }>;
  registers: Array<{ id: string; name: string }>;
}
interface CartLine {
  variantId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export default function PosPage() {
  const api = useTenantApi();
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; total: string } | null>(null);

  useEffect(() => {
    api<{ products: Product[] }>('/products', { query: { pageSize: 100 } })
      .then((r) => setProducts(r.products))
      .catch((e) => setError(e.message));
    api<Branch[]>('/branches')
      .then(setBranches)
      .catch((e) => setError(e.message));
  }, [api]);

  const branch = branches[0];
  const stockLocation =
    branch?.stockLocations.find((l) => l.isDefault) ?? branch?.stockLocations[0];
  const register = branch?.registers[0];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.variants.some((v) => v.sku.toLowerCase().includes(q)),
    );
  }, [products, search]);

  function addToCart(product: Product, variant: Variant) {
    setCart((c) => {
      const existing = c.find((l) => l.variantId === variant.id);
      if (existing) {
        return c.map((l) => (l.variantId === variant.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...c,
        {
          variantId: variant.id,
          name: product.name,
          sku: variant.sku,
          unitPrice: Number(variant.retailPrice),
          quantity: 1,
        },
      ];
    });
  }

  function updateQuantity(variantId: string, quantity: number) {
    setCart((c) =>
      quantity <= 0
        ? c.filter((l) => l.variantId !== variantId)
        : c.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)),
    );
  }

  const total = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  async function handleCheckout() {
    if (!branch || !stockLocation || cart.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const sale = await api<{ id: string; total: string }>('/sales', {
        method: 'POST',
        body: {
          clientMutationId: uuid(),
          branchId: branch.id,
          registerId: register?.id,
          stockLocationId: stockLocation.id,
          lines: cart.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            discountAmount: 0,
          })),
          payments: [{ method: paymentMethod, amount: Number(total.toFixed(2)) }],
          currency: 'USD',
        },
      });
      setReceipt({ id: sale.id, total: sale.total });
      setCart([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!branch) {
    return <p className="text-sm text-gray-500">Loading branch…</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <input
          placeholder="Search products or scan a barcode…"
          className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-600 dark:bg-gray-900"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.flatMap((p) =>
            p.variants.map((v) => (
              <button
                key={v.id}
                onClick={() => addToCart(p, v)}
                disabled={v.availableQuantity <= 0}
                className="card flex flex-col items-start p-3 text-left hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-xs text-gray-500">{v.sku}</span>
                <span className="mt-2 text-sm font-semibold">${v.retailPrice}</span>
                <span className="text-xs text-gray-400">{v.availableQuantity} on hand</span>
              </button>
            )),
          )}
          {filtered.length === 0 && (
            <p className="col-span-full text-sm text-gray-500">No products match your search.</p>
          )}
        </div>
      </div>

      <div className="card flex flex-col p-4">
        <h2 className="mb-3 text-sm font-semibold">Cart</h2>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {cart.map((line) => (
            <div key={line.variantId} className="flex items-center justify-between text-sm">
              <div>
                <p>{line.name}</p>
                <p className="text-xs text-gray-500">
                  ${line.unitPrice.toFixed(2)} × {line.quantity}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQuantity(line.variantId, line.quantity - 1)}
                  className="h-6 w-6 rounded border border-gray-300 dark:border-gray-600"
                >
                  −
                </button>
                <span>{line.quantity}</span>
                <button
                  onClick={() => updateQuantity(line.variantId, line.quantity + 1)}
                  className="h-6 w-6 rounded border border-gray-300 dark:border-gray-600"
                >
                  +
                </button>
              </div>
            </div>
          ))}
          {cart.length === 0 && <p className="text-sm text-gray-500">Cart is empty.</p>}
        </div>

        <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
          <div className="mb-3 flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
          <select
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="MOBILE_MONEY">Mobile money</option>
          </select>
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          {receipt && (
            <p className="mb-2 text-sm text-green-600">Sale completed — total ${receipt.total}.</p>
          )}
          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Processing…' : 'Charge'}
          </button>
        </div>
      </div>
    </div>
  );
}
