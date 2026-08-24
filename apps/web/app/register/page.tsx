'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api-client';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/auth/register', { method: 'POST', body: { name, email, password } });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.issues?.[0]?.message ?? err.message) : 'Registration failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card max-w-sm p-8 text-center">
          <h1 className="mb-2 text-xl font-semibold">Check your email</h1>
          <p className="text-sm text-gray-500">
            We sent a verification link to {email}. Verify your address, then{' '}
            <Link href="/login" className="text-brand-600 hover:underline">
              sign in
            </Link>{' '}
            to set up your business.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <h1 className="mb-1 text-xl font-semibold">Create your account</h1>
        <p className="mb-6 text-sm text-gray-500">Password must be at least 10 characters.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="text-sm">
            Full name
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Email
            <input
              type="email"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Password
            <input
              type="password"
              minLength={10}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Create account
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
