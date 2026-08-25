'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  taxAmount: string;
  discountAmount: string;
  lineTotal: string;
}

interface Payment {
  id: string;
  amount: string;
  method: string;
  createdAt: string;
}

interface PublicInvoice {
  id: string;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  amountPaid: string;
  notes: string | null;
  termsText: string | null;
  lines: InvoiceLine[];
  payments: Payment[];
  customer: { name: string; email: string | null };
}

export default function PublicInvoicePage({ params }: { params: { token: string } }) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PublicInvoice>(`/public/invoices/${params.token}`)
      .then(setInvoice)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load invoice'));
  }, [params.token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  const amountDue = (Number(invoice.total) - Number(invoice.amountPaid)).toFixed(2);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoice {invoice.number}</h1>
          <p className="text-sm text-gray-500">Billed to {invoice.customer.name}</p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {invoice.status}
        </span>
      </div>

      <div className="card grid grid-cols-2 gap-3 p-4 text-sm">
        <div>
          <div className="text-gray-500">Issue date</div>
          <div>{new Date(invoice.issueDate).toLocaleDateString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Due date</div>
          <div>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}</div>
        </div>
      </div>

      <div className="card overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="pb-2">Description</th>
              <th className="pb-2">Qty</th>
              <th className="pb-2">Unit price</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-2">{line.description}</td>
                <td className="py-2">{line.quantity}</td>
                <td className="py-2">
                  {invoice.currency} {line.unitPrice}
                </td>
                <td className="py-2 text-right">
                  {invoice.currency} {line.lineTotal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-col items-end gap-1 text-sm">
          <div className="flex w-48 justify-between">
            <span className="text-gray-500">Subtotal</span>
            <span>
              {invoice.currency} {invoice.subtotal}
            </span>
          </div>
          <div className="flex w-48 justify-between">
            <span className="text-gray-500">Tax</span>
            <span>
              {invoice.currency} {invoice.taxTotal}
            </span>
          </div>
          <div className="flex w-48 justify-between font-semibold">
            <span>Total</span>
            <span>
              {invoice.currency} {invoice.total}
            </span>
          </div>
          <div className="flex w-48 justify-between text-gray-500">
            <span>Paid</span>
            <span>
              {invoice.currency} {invoice.amountPaid}
            </span>
          </div>
          <div className="flex w-48 justify-between font-semibold text-brand-600">
            <span>Amount due</span>
            <span>
              {invoice.currency} {amountDue}
            </span>
          </div>
        </div>
      </div>

      {invoice.notes && <p className="text-sm text-gray-500">{invoice.notes}</p>}
      {invoice.termsText && <p className="text-xs text-gray-400">{invoice.termsText}</p>}
    </div>
  );
}
