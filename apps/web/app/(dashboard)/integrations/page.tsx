'use client';

import { useEffect, useState } from 'react';
import { useTenantApi } from '@/lib/use-tenant-api';

type ConnectionStatus = 'PENDING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';

interface Connection {
  id: string;
  provider: string;
  name: string;
  storeUrl: string | null;
  status: ConnectionStatus;
  lastSyncAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface SyncJob {
  id: string;
  domain: string;
  direction: string;
  status: string;
  itemsProcessed: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface ConnectionHealth {
  connection: Connection;
  recentSyncJobs: SyncJob[];
  webhooksDelivered: number;
  webhooksFailed: number;
}

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  CONNECTED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  DISCONNECTED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const EMPTY_FORM = {
  name: '',
  storeUrl: '',
  consumerKey: '',
  consumerSecret: '',
  webhookSecret: '',
};

export default function IntegrationsPage() {
  const api = useTenantApi();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [health, setHealth] = useState<Record<string, ConnectionHealth>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  function load() {
    api<Connection[]>('/integrations/connections')
      .then(setConnections)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [api]);

  async function loadHealth(id: string) {
    try {
      const result = await api<ConnectionHealth>(`/integrations/connections/${id}/health`);
      setHealth((prev) => ({ ...prev, [id]: result }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load connection health');
    }
  }

  function toggleExpand(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next) loadHealth(next);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/integrations/connections', {
        method: 'POST',
        body: {
          provider: 'WOOCOMMERCE',
          name: form.name,
          storeUrl: form.storeUrl,
          credentials: {
            consumerKey: form.consumerKey,
            consumerSecret: form.consumerSecret,
            ...(form.webhookSecret ? { webhookSecret: form.webhookSecret } : {}),
          },
        },
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect store');
    }
  }

  async function runAction(id: string, label: string, run: () => Promise<unknown>) {
    setBusyId(id);
    setActionMessage(null);
    setError(null);
    try {
      await run();
      setActionMessage(`${label} succeeded.`);
      load();
      if (expandedId === id) loadHealth(id);
    } catch (err) {
      setError(err instanceof Error ? `${label} failed: ${err.message}` : `${label} failed.`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Integrations</h1>
          <p className="text-sm text-gray-500">
            Connect e-commerce stores to sync products, inventory, and orders. Only WooCommerce is
            wired up in this phase — Shopify and generic REST connections are not yet available.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          {showForm ? 'Cancel' : 'Connect WooCommerce store'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card grid grid-cols-2 gap-3 p-4">
          <input
            required
            placeholder="Connection name (e.g. Main store)"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            required
            placeholder="Store URL (https://mystore.example.com)"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.storeUrl}
            onChange={(e) => setForm({ ...form, storeUrl: e.target.value })}
          />
          <input
            required
            placeholder="Consumer key (ck_...)"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.consumerKey}
            onChange={(e) => setForm({ ...form, consumerKey: e.target.value })}
          />
          <input
            required
            placeholder="Consumer secret (cs_...)"
            type="password"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.consumerSecret}
            onChange={(e) => setForm({ ...form, consumerSecret: e.target.value })}
          />
          <input
            placeholder="Webhook secret (optional, needed for live sync)"
            type="password"
            className="col-span-2 rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
            value={form.webhookSecret}
            onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
          />
          {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
          <button className="col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Authorize and connect
          </button>
        </form>
      )}

      {!showForm && error && <p className="text-sm text-red-600">{error}</p>}
      {actionMessage && <p className="text-sm text-green-600">{actionMessage}</p>}

      <div className="flex flex-col gap-3">
        {connections?.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status]}`}
                  >
                    {c.status}
                  </span>
                  <span className="text-xs text-gray-500">{c.provider}</span>
                </div>
                <span className="text-xs text-gray-500">{c.storeUrl}</span>
                <span className="text-xs text-gray-500">
                  Last sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : 'never'}
                </span>
                {c.lastError && (
                  <span className="text-xs text-red-600">
                    Last error ({c.lastErrorAt ? new Date(c.lastErrorAt).toLocaleString() : ''}):{' '}
                    {c.lastError}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={busyId === c.id}
                  onClick={() =>
                    runAction(c.id, 'Test connection', () =>
                      api(`/integrations/connections/${c.id}/test`, { method: 'POST' }),
                    )
                  }
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-gray-600"
                >
                  Test
                </button>
                <button
                  disabled={busyId === c.id}
                  onClick={() =>
                    runAction(c.id, 'Product sync', () =>
                      api(`/integrations/connections/${c.id}/sync`, {
                        method: 'POST',
                        body: { domain: 'PRODUCTS' },
                      }),
                    )
                  }
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-gray-600"
                >
                  Sync products
                </button>
                <button
                  disabled={busyId === c.id}
                  onClick={() =>
                    runAction(c.id, 'Inventory push', () =>
                      api(`/integrations/connections/${c.id}/sync`, {
                        method: 'POST',
                        body: { domain: 'INVENTORY' },
                      }),
                    )
                  }
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-gray-600"
                >
                  Push inventory
                </button>
                <button
                  disabled={busyId === c.id || c.status === 'DISCONNECTED'}
                  onClick={() =>
                    runAction(c.id, 'Disconnect', () =>
                      api(`/integrations/connections/${c.id}/disconnect`, { method: 'POST' }),
                    )
                  }
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-50 dark:border-red-800"
                >
                  Disconnect
                </button>
                <button
                  onClick={() => toggleExpand(c.id)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand-600 hover:underline"
                >
                  {expandedId === c.id ? 'Hide details' : 'Details'}
                </button>
              </div>
            </div>

            {expandedId === c.id && (
              <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
                {!health[c.id] ? (
                  <p className="text-sm text-gray-500">Loading health…</p>
                ) : (
                  <>
                    <div className="mb-3 flex gap-6 text-sm">
                      <span>
                        Webhooks delivered: <strong>{health[c.id].webhooksDelivered}</strong>
                      </span>
                      <span>
                        Webhooks failed:{' '}
                        <strong className={health[c.id].webhooksFailed > 0 ? 'text-red-600' : ''}>
                          {health[c.id].webhooksFailed}
                        </strong>
                      </span>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="text-left text-gray-500">
                        <tr>
                          <th className="p-2">Domain</th>
                          <th className="p-2">Direction</th>
                          <th className="p-2">Status</th>
                          <th className="p-2">Items</th>
                          <th className="p-2">Started</th>
                          <th className="p-2">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {health[c.id].recentSyncJobs.map((job) => (
                          <tr
                            key={job.id}
                            className="border-t border-gray-100 dark:border-gray-800"
                          >
                            <td className="p-2">{job.domain}</td>
                            <td className="p-2">{job.direction}</td>
                            <td className="p-2">{job.status}</td>
                            <td className="p-2">{job.itemsProcessed}</td>
                            <td className="p-2">{new Date(job.startedAt).toLocaleString()}</td>
                            <td className="p-2 text-red-600">{job.error ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {health[c.id].recentSyncJobs.length === 0 && (
                      <p className="p-3 text-center text-sm text-gray-500">No sync jobs yet.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {connections && connections.length === 0 && (
          <div className="card p-6 text-center text-sm text-gray-500">
            No commerce integrations connected yet.
          </div>
        )}
      </div>
    </div>
  );
}
