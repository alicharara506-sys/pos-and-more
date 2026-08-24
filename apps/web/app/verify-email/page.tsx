'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api-client';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token.');
      return;
    }
    apiFetch(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(() => setStatus('ok'))
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : 'Verification failed');
      });
  }, [token]);

  return (
    <div className="card max-w-sm p-8 text-center">
      {status === 'pending' && <p className="text-sm text-gray-500">Verifying…</p>}
      {status === 'ok' && (
        <>
          <h1 className="mb-2 text-xl font-semibold">Email verified</h1>
          <Link href="/login" className="text-brand-600 hover:underline">
            Continue to sign in
          </Link>
        </>
      )}
      {status === 'error' && <p className="text-sm text-red-600">{message}</p>}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
        <VerifyEmailInner />
      </Suspense>
    </div>
  );
}
