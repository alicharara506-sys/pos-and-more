'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, appleLoginUrl, googleLoginUrl, ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/session-context';

type Mode = 'password' | 'magic-link' | 'mfa';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaChallengeToken, setMfaChallengeToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<{
        mfaRequired?: boolean;
        mfaChallengeToken?: string;
        user?: unknown;
      }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      if (result.mfaRequired && result.mfaChallengeToken) {
        setMfaChallengeToken(result.mfaChallengeToken);
        setMode('mfa');
      } else {
        await refresh();
        router.push('/');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/auth/mfa/verify', {
        method: 'POST',
        body: { mfaChallengeToken, code: mfaCode },
      });
      await refresh();
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/auth/magic-link/request', { method: 'POST', body: { email } });
      setInfo(
        'If that email has an account, a sign-in link is on its way. Check the API console log in dev.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send magic link');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <h1 className="mb-1 text-xl font-semibold">Sign in to SalesMaster Pro</h1>
        <p className="mb-6 text-sm text-gray-500">Run your business from one place.</p>

        <div className="mb-6 flex flex-col gap-2">
          <a
            href={googleLoginUrl()}
            className="flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Continue with Google
          </a>
          <a
            href={appleLoginUrl()}
            className="flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Continue with Apple
          </a>
        </div>

        <div className="mb-4 flex items-center gap-2 text-xs text-gray-400">
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          or
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        </div>

        {mode === 'mfa' ? (
          <form onSubmit={handleMfaVerify} className="flex flex-col gap-3">
            <label className="text-sm">
              Enter your 6-digit authenticator code
              <input
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                maxLength={6}
                required
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              disabled={submitting}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Verify
            </button>
          </form>
        ) : (
          <>
            <form
              onSubmit={mode === 'password' ? handlePasswordLogin : handleMagicLink}
              className="flex flex-col gap-3"
            >
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
              {mode === 'password' && (
                <label className="text-sm">
                  Password
                  <input
                    type="password"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              {info && <p className="text-sm text-green-600">{info}</p>}
              <button
                disabled={submitting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {mode === 'password' ? 'Sign in' : 'Send sign-in link'}
              </button>
            </form>
            <button
              className="mt-3 text-sm text-brand-600 hover:underline"
              onClick={() => setMode(mode === 'password' ? 'magic-link' : 'password')}
            >
              {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
            </button>
          </>
        )}

        <p className="mt-6 text-center text-sm text-gray-500">
          New here?{' '}
          <Link href="/register" className="text-brand-600 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
