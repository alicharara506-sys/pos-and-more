'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/session-context';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NGN', 'KES', 'ZAR', 'INR'];

export default function OnboardingPage() {
  const router = useRouter();
  const { refresh, setCurrentTenantId } = useSession();
  const [step, setStep] = useState<'business' | 'invite' | 'done'>('business');
  const [newTenantId, setNewTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    legalName: '',
    displayName: '',
    category: '',
    country: 'US',
    locale: 'en-US',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    baseCurrency: 'USD',
    firstBranchName: 'Main Branch',
    firstBranchAddress: '',
  });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('cashier');
  const [inviteSent, setInviteSent] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleCreateTenant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<{ tenant: { id: string } }>('/onboarding/tenant', {
        method: 'POST',
        body: form,
      });
      setNewTenantId(result.tenant.id);
      setCurrentTenantId(result.tenant.id);
      await refresh();
      setStep('invite');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.issues?.[0]?.message ?? err.message)
          : 'Could not create your business',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!newTenantId) return;
    setError(null);
    try {
      await apiFetch('/onboarding/invite', {
        method: 'POST',
        tenantId: newTenantId,
        body: { email: inviteEmail, roleKey: inviteRole, branchScope: [] },
      });
      setInviteSent(inviteEmail);
      setInviteEmail('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send invitation');
    }
  }

  if (step === 'invite') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card w-full max-w-md p-8">
          <h1 className="mb-1 text-xl font-semibold">Invite your team</h1>
          <p className="mb-6 text-sm text-gray-500">
            Optional — you can always invite people later from Settings.
          </p>
          <form onSubmit={handleInvite} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="teammate@company.com"
              className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
              <option value="inventory_clerk">Inventory Clerk</option>
              <option value="viewer">Viewer / Accountant</option>
            </select>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {inviteSent && (
              <p className="text-sm text-green-600">Invitation sent to {inviteSent}.</p>
            )}
            <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Send invitation
            </button>
          </form>
          <button
            onClick={() => router.push('/dashboard')}
            className="mt-6 w-full text-sm text-gray-500 hover:underline"
          >
            Skip for now — go to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="card w-full max-w-lg p-8">
        <h1 className="mb-1 text-xl font-semibold">Set up your business</h1>
        <p className="mb-6 text-sm text-gray-500">
          Starts at $10/month — one branch and one user included. Add branches ($5/mo each) or
          teammates ($2/mo each) any time.
        </p>
        <form onSubmit={handleCreateTenant} className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-sm">
            Business display name
            <input
              required
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={form.displayName}
              onChange={(e) => update('displayName', e.target.value)}
            />
          </label>
          <label className="col-span-2 text-sm">
            Legal name
            <input
              required
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={form.legalName}
              onChange={(e) => update('legalName', e.target.value)}
            />
          </label>
          <label className="text-sm">
            Category
            <input
              placeholder="Retail, café, salon…"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={form.category}
              onChange={(e) => update('category', e.target.value)}
            />
          </label>
          <label className="text-sm">
            Country (ISO 2-letter)
            <input
              required
              maxLength={2}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 uppercase dark:border-gray-600 dark:bg-gray-900"
              value={form.country}
              onChange={(e) => update('country', e.target.value.toUpperCase())}
            />
          </label>
          <label className="text-sm">
            Currency
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={form.baseCurrency}
              onChange={(e) => update('baseCurrency', e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Timezone
            <input
              required
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={form.timezone}
              onChange={(e) => update('timezone', e.target.value)}
            />
          </label>
          <label className="col-span-2 text-sm">
            First branch name
            <input
              required
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={form.firstBranchName}
              onChange={(e) => update('firstBranchName', e.target.value)}
            />
          </label>
          <label className="col-span-2 text-sm">
            Branch address (optional)
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={form.firstBranchAddress}
              onChange={(e) => update('firstBranchAddress', e.target.value)}
            />
          </label>
          {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
          <button
            disabled={submitting}
            className="col-span-2 mt-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Creating your business…' : 'Create business'}
          </button>
        </form>
      </div>
    </div>
  );
}
